import {
  clearSuggestedQuestions,
  derivePaperQuestions,
  getCachedQuestions,
  saveSuggestedQuestions,
} from '../core/questions/repo.js'
import type { SuggestedQuestionRecord } from '../core/questions/repo.js'
import { deleteChatSession, listChatSessions, updateChatSessionTitle } from '../core/chat/repo.js'
import type { ChatSessionSummary } from '../core/chat/repo.js'
import { app, BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Database } from 'better-sqlite3'

import { StdioAcpClient } from '../core/acp/stdio-client.js'
import type { AskOpenResult, AskStartParams, AskStreamEvent } from '../core/chat/manager.js'
import type { AcpBackend } from '../core/acp/client.js'
import { ChatManager } from '../core/chat/manager.js'
import { getChatSession } from '../core/chat/repo.js'
import { ingest } from '../core/ingest/index.js'
import type { IngestResult } from '../core/ingest/index.js'
import { getPaper, listPapers, trashPaper, restorePaper, purgePaper } from '../core/library/repo.js'
import { getUsageSummary, listUsageRecords, type ListUsageOptions } from '../core/usage/repo.js'
import type { ListPapersOptions, PaperRecord, PaperSortColumn } from '../core/library/repo.js'
import { deleteNote, getNote, upsertNote } from '../core/notes/repo.js'
import {
  assignPaperToCollection,
  createCollection,
  deleteCollection,
  getCollectionsTree,
  listCollections,
  listPaperCollections,
  removePaperFromCollection,
  renameCollection,
  type CollectionRecord,
  type CollectionTreeItem,
} from '../core/collections/repo.js'
import type { NoteRecord } from '../core/notes/repo.js'
import { createHighlight, deleteHighlight, listHighlights } from '../core/highlights/repo.js'
import type { HighlightRecord } from '../core/highlights/repo.js'
import { openDb } from '../core/store/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Filesystem-safe slug shape enforced at ingest time (core/ingest/classify.ts).
// Re-validated here so a malformed/hostile slug from the renderer can never
// escape data/papers/ via `..`/path separators. Must start with an
// alphanumeric char specifically so a slug can never equal (or start with) a
// `.`/`..` segment — a leading dot/dash/underscore would otherwise let
// `join()` walk out of data/papers/.
const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

// Vellum main process.
// Responsibilities (built out per the wiki task cards):
//   - own the app window + lifecycle
//   - expose backend logic in core/ to the renderer over typed IPC
//   - spawn ACP agent subprocesses (claude-code-acp / codex-acp) over stdio
//
// Everything below is the minimal boot skeleton. Feature work attaches here.

function resolvePreloadPath(): string {
  const mjs = join(__dirname, '../preload/preload.mjs')
  if (existsSync(mjs)) return mjs
  return join(__dirname, '../preload/index.js')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- IPC surface (grows as features land) ---------------------------------
// Placeholder handler proves the preload bridge works end-to-end.
ipcMain.handle('vellum:ping', () => 'pong')

// [P1-09] Reader's only file-access seam: reads data/papers/<slug>/paper.pdf
// relative to cwd (same convention as core/store/db.ts's DEFAULT_DB_PATH).
// Returns null (not a thrown error) for a missing/invalid slug or file so
// the renderer can render its empty state instead of crashing.
ipcMain.handle('vellum:read-paper-file', async (_event, slug: unknown): Promise<ArrayBuffer | null> => {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return null

  const pdfPath = join(process.cwd(), 'data', 'papers', slug, 'paper.pdf')
  try {
    const buffer = await readFile(pdfPath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  } catch {
    return null
  }
})

// [P1-06] Ingest IPC seam. Lazily opens the one app.db handle on first use
// (schema-migrated via core/store/db.ts's openDb()) rather than at module
// load — keeps `import`ing main.ts side-effect-free for tests, and means the
// data/ dir isn't created until a paper is actually ingested.
let db: Database | undefined
function getDb(): Database {
  if (!db) db = openDb()
  return db
}

// Persists a paper end-to-end (classify -> fetch -> convert -> extract ->
// write files + DB row — see core/ingest/index.ts). Re-ingesting the same
// input is idempotent (upsert-by-slug). Rejects the renderer's promise on
// failure (bad input, network error, ...) rather than swallowing it — unlike
// read-paper-file's null-on-miss, ingest failures are actionable and the
// caller should see them.
ipcMain.handle('vellum:ingest', async (_event, input: unknown): Promise<IngestResult> => {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('vellum:ingest: input must be a non-empty string')
  }
  return ingest(input, { db: getDb() })
})

const SORT_COLUMN_VALUES: readonly PaperSortColumn[] = ['addedAt', 'year', 'title']

// [P1-08] Library grid data. `options` arrives from the renderer as untyped
// `unknown` — narrowed field-by-field here rather than trusted via a cast.
// core/library/repo.ts's listPapers() is independently defensive about a bad
// `sort` value (falls back to the added_at default), so this narrowing is
// belt-and-suspenders, not the only guard against sort-column injection.
function toListPapersOptions(value: unknown): ListPapersOptions {
  if (typeof value !== 'object' || value === null) return {}
  const candidate = value as Record<string, unknown>

  const search = typeof candidate['search'] === 'string' ? candidate['search'] : undefined
  const sort = SORT_COLUMN_VALUES.includes(candidate['sort'] as PaperSortColumn)
    ? (candidate['sort'] as PaperSortColumn)
    : undefined
  const order = candidate['order'] === 'asc' || candidate['order'] === 'desc' ? candidate['order'] : undefined
  const collectionId = typeof candidate['collectionId'] === 'number' ? candidate['collectionId'] : undefined
  const trashed = typeof candidate['trashed'] === 'boolean' ? candidate['trashed'] : undefined

  return { search, collectionId, sort, order, trashed }
}

// Library grid data [P1-08]. Read-only, no slug/path handling needed (unlike
// read-paper-file) — just forwards a sanitized query to the repo.
ipcMain.handle('vellum:list-papers', (_event, options: unknown): PaperRecord[] => {
  return listPapers(getDb(), toListPapersOptions(options))
})

ipcMain.handle('vellum:get-paper', (_event, slug: unknown): PaperRecord | null => {
  return getPaper(getDb(), requireSlug(slug, 'vellum:get-paper')) ?? null
})

// [L2-04] Trash and Purge operations ----------------------------------------
ipcMain.handle('vellum:paper-trash', (_event, slug: unknown): PaperRecord | null => {
  return trashPaper(getDb(), requireSlug(slug, 'vellum:paper-trash')) ?? null
})

ipcMain.handle('vellum:paper-restore', (_event, slug: unknown): PaperRecord | null => {
  return restorePaper(getDb(), requireSlug(slug, 'vellum:paper-restore')) ?? null
})

ipcMain.handle('vellum:paper-purge', (_event, slug: unknown): boolean => {
  return purgePaper(getDb(), requireSlug(slug, 'vellum:paper-purge'), 'data')
})

// [L2-05] Usage & Telemetry operations ---------------------------------------
ipcMain.handle('vellum:usage-summary', () => {
  return getUsageSummary(getDb())
})

ipcMain.handle('vellum:usage-list', (_event, options: unknown) => {
  const opts = (typeof options === 'object' && options !== null) ? options as ListUsageOptions : {}
  return listUsageRecords(getDb(), opts)
})

// [P2-01] Notes tab — one freeform markdown note per paper. -----------------
//
// `getNote` returns undefined for "no note yet"; normalized to null over IPC
// (matching `vellum:get-paper`'s convention) since `undefined` doesn't
// survive structured clone.
ipcMain.handle('vellum:notes-get', (_event, slug: unknown): NoteRecord | null => {
  return getNote(getDb(), requireSlug(slug, 'vellum:notes-get')) ?? null
})

function parseNotesSaveParams(value: unknown): { slug: string; body: string } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('vellum:notes-save: params must be an object')
  }
  const candidate = value as Record<string, unknown>
  const body = candidate['body']
  if (typeof body !== 'string') {
    throw new Error('vellum:notes-save: body must be a string')
  }
  return { slug: requireSlug(candidate['slug'], 'vellum:notes-save'), body }
}

// Autosave's persistence half — a plain upsert-by-paper-slug (core/notes/repo.ts).
ipcMain.handle('vellum:notes-save', (_event, params: unknown): NoteRecord => {
  const { slug, body } = parseNotesSaveParams(params)
  return upsertNote(getDb(), slug, body)
})

// Delete half of Notes CRUD — "Clear note" in the tab. No-op if the paper
// has no note yet.
ipcMain.handle('vellum:notes-delete', (_event, slug: unknown): void => {
  deleteNote(getDb(), requireSlug(slug, 'vellum:notes-delete'))
})

// [P2-02] Highlight tool + Annotations tab. ---------------------------------
//
// `id`/`createdAt` are stamped here (not by the renderer) — same convention
// as `vellum:ask-start`'s requestId — so storage stays deterministic and
// testable (core/highlights/repo.ts takes both as caller-supplied input).
// `anchor`/`quote`/`color` are opaque strings from the renderer's text-layer
// selection logic; validated only for type/shape, never parsed here.
function parseHighlightsCreateParams(value: unknown): {
  slug: string
  page: number
  color: string
  quote: string
  anchor: string
} {
  if (typeof value !== 'object' || value === null) {
    throw new Error('vellum:highlights-create: params must be an object')
  }
  const candidate = value as Record<string, unknown>
  const page = candidate['page']
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    throw new Error('vellum:highlights-create: page must be a positive integer')
  }
  const color = candidate['color']
  const quote = candidate['quote']
  const anchor = candidate['anchor']
  if (typeof color !== 'string' || typeof quote !== 'string' || typeof anchor !== 'string') {
    throw new Error('vellum:highlights-create: color, quote, and anchor must be strings')
  }
  return { slug: requireSlug(candidate['slug'], 'vellum:highlights-create'), page, color, quote, anchor }
}

ipcMain.handle('vellum:highlights-create', (_event, params: unknown): HighlightRecord => {
  const { slug, page, color, quote, anchor } = parseHighlightsCreateParams(params)
  return createHighlight(getDb(), {
    id: randomUUID(),
    paperSlug: slug,
    page,
    color,
    quote,
    anchor,
    createdAt: new Date().toISOString(),
  })
})

ipcMain.handle('vellum:highlights-list', (_event, slug: unknown): HighlightRecord[] => {
  return listHighlights(getDb(), requireSlug(slug, 'vellum:highlights-list'))
})

function requireNonEmptyId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${channel}: id must be a non-empty string`)
  }
  return value
}

ipcMain.handle('vellum:highlights-delete', (_event, id: unknown): void => {
  deleteHighlight(getDb(), requireNonEmptyId(id, 'vellum:highlights-delete'))
})

// [P1-10] Ask tab — grounded chat over ACP. -------------------------------
//
// One ChatManager for the process lifetime: it caches an AcpSession per
// paper slug (session/new cold start is ~16s — see core/acp/stdio-client.ts)
// so follow-up turns in the same chat don't re-pay that cost. Lazily
// constructed for the same reason `db` is lazy — no adapter spawned, no
// window created, until a paper's Ask tab actually does something.
let chatManager: ChatManager | undefined
function getChatManager(): ChatManager {
  if (!chatManager) chatManager = new ChatManager(new StdioAcpClient())
  return chatManager
}

function requireSlug(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
    throw new Error(`${channel}: invalid slug`)
  }
  return value
}

function parseAskOpenParams(value: unknown, maybeSessionId?: unknown): { slug: string; sessionId?: number } {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>
    const slug = requireSlug(candidate['slug'], 'vellum:ask-open')
    const sessionId = typeof candidate['sessionId'] === 'number' && Number.isInteger(candidate['sessionId'])
      ? candidate['sessionId']
      : undefined
    return { slug, sessionId }
  }
  const slug = requireSlug(value, 'vellum:ask-open')
  const sessionId = typeof maybeSessionId === 'number' && Number.isInteger(maybeSessionId)
    ? maybeSessionId
    : undefined
  return { slug, sessionId }
}

// Open (or reload) the Ask tab for a paper: returns the requested or most
// recent chat session for this slug + its full history.
ipcMain.handle('vellum:ask-open', (_event, slugOrParams: unknown, maybeSessionId?: unknown): AskOpenResult => {
  const { slug, sessionId } = parseAskOpenParams(slugOrParams, maybeSessionId)
  return getChatManager().openChat({ db: getDb(), paperSlug: slug, chatSessionId: sessionId })
})

// [L2-02] Cross-paper chat library IPC handlers
ipcMain.handle('vellum:chat-list-sessions', (_event, options: unknown): ChatSessionSummary[] => {
  let search: string | undefined
  let limit: number | undefined
  if (typeof options === 'object' && options !== null) {
    const opts = options as Record<string, unknown>
    if (typeof opts['search'] === 'string') search = opts['search']
    if (typeof opts['limit'] === 'number' && Number.isInteger(opts['limit']) && opts['limit'] > 0) {
      limit = opts['limit']
    }
  }
  return listChatSessions(getDb(), { search, limit })
})

ipcMain.handle('vellum:chat-delete-session', (_event, id: unknown): void => {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('vellum:chat-delete-session: id must be an integer')
  }
  deleteChatSession(getDb(), id)
})

ipcMain.handle('vellum:chat-rename-session', (_event, params: unknown): void => {
  if (typeof params !== 'object' || params === null) {
    throw new Error('vellum:chat-rename-session: params must be an object')
  }
  const { id, title } = params as Record<string, unknown>
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('vellum:chat-rename-session: id must be an integer')
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('vellum:chat-rename-session: title must be a non-empty string')
  }
  updateChatSessionTitle(getDb(), id, title)
})

// "New chat" action: fresh chat_sessions row + disposes any cached ACP
// session for this paper so the agent has no memory of the prior thread.
function requireBackend(value: unknown, channel: string): AcpBackend {
  if (value === 'claude' || value === 'codex') return value
  throw new Error(`${channel}: backend must be 'claude' or 'codex'`)
}

function parseAskNewChatParams(value: unknown): { slug: string; backend: AcpBackend } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('vellum:ask-new-chat: params must be an object')
  }
  const candidate = value as Record<string, unknown>
  return {
    slug: requireSlug(candidate['slug'], 'vellum:ask-new-chat'),
    backend: requireBackend(candidate['backend'], 'vellum:ask-new-chat'),
  }
}

ipcMain.handle('vellum:ask-new-chat', async (_event, params: unknown): Promise<AskOpenResult> => {
  const { slug: paperSlug, backend } = parseAskNewChatParams(params)
  const session = await getChatManager().newChat({ db: getDb(), paperSlug, backend })
  return { session, messages: [] }
})

function parseAskStartParams(value: unknown): AskStartParams {
  if (typeof value !== 'object' || value === null) {
    throw new Error('vellum:ask-start: params must be an object')
  }
  const candidate = value as Record<string, unknown>
  const chatSessionId = candidate['chatSessionId']
  const text = candidate['text']
  if (typeof chatSessionId !== 'number' || !Number.isInteger(chatSessionId)) {
    throw new Error('vellum:ask-start: chatSessionId must be an integer')
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('vellum:ask-start: text must be a non-empty string')
  }
  return { chatSessionId, slug: requireSlug(candidate['slug'], 'vellum:ask-start'), text }
}

// Starts a turn and returns immediately with a `requestId` — the turn itself
// runs async and streams `AskStreamEvent`s back over `vellum:ask-update`
// (renderer subscribes via preload's `onAskUpdate`, keyed by that id). This
// is the streaming half of [P1-10]: AcpSession.prompt() yields updates in
// this (main) process; ipcMain.handle can only return one value, so the
// reply itself can't carry the stream — a push channel does.
ipcMain.handle('vellum:ask-start', (event: IpcMainInvokeEvent, params: unknown): { requestId: string } => {
  const parsed = parseAskStartParams(params)
  const db = getDb()

  // `chatSessionId` and `slug` arrive as two independent IPC params — verify
  // the session actually belongs to that paper before running a turn on it.
  // Without this, a mismatched pair (renderer bug, or a hostile page) could
  // write turns onto another paper's chat history.
  const chatSession = getChatSession(db, parsed.chatSessionId)
  if (!chatSession || chatSession.paperSlug !== parsed.slug) {
    throw new Error(`vellum:ask-start: chat session ${parsed.chatSessionId} does not belong to paper '${parsed.slug}'`)
  }

  const paper = getPaper(db, parsed.slug)
  if (!paper?.mdPath) {
    throw new Error(`vellum:ask-start: paper '${parsed.slug}' has no markdown to ground on`)
  }
  const mdPath = paper.mdPath

  const requestId = randomUUID()
  const sender = event.sender

  function send(update: AskStreamEvent): void {
    if (!sender.isDestroyed()) sender.send('vellum:ask-update', { requestId, event: update })
  }

  const backend = requireBackend(chatSession.backend, 'vellum:ask-start')
  getChatManager()
    .runTurn({ db, chatSessionId: parsed.chatSessionId, paperSlug: parsed.slug, mdPath, text: parsed.text, backend }, send)
    .catch((err: unknown) => {
      send({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    })

  return { requestId }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Dispose cached ACP sessions (kills the adapter subprocesses) rather than
// leaving them to be reaped by process exit.
app.on('before-quit', () => {
  chatManager?.disposeAll().catch(() => undefined)
})

// [L2-01] Collections & Library filtering ------------------------------------
ipcMain.handle('vellum:collections-list', (): CollectionRecord[] => {
  return listCollections(getDb())
})

ipcMain.handle('vellum:collections-tree', (): CollectionTreeItem[] => {
  return getCollectionsTree(getDb())
})

ipcMain.handle('vellum:collections-create', (_event, params: unknown): CollectionRecord => {
  if (typeof params !== 'object' || params === null) {
    throw new Error('vellum:collections-create: params must be an object')
  }
  const { name, parentId } = params as { name: unknown; parentId?: unknown }
  if (typeof name !== 'string') {
    throw new Error('vellum:collections-create: name must be a string')
  }
  const pid = typeof parentId === 'number' ? parentId : null
  return createCollection(getDb(), { name, parentId: pid })
})

ipcMain.handle('vellum:collections-rename', (_event, params: unknown): void => {
  if (typeof params !== 'object' || params === null) {
    throw new Error('vellum:collections-rename: params must be an object')
  }
  const { id, name } = params as { id: unknown; name: unknown }
  if (typeof id !== 'number' || typeof name !== 'string') {
    throw new Error('vellum:collections-rename: id must be number and name must be string')
  }
  renameCollection(getDb(), id, name)
})

ipcMain.handle('vellum:collections-delete', (_event, id: unknown): void => {
  if (typeof id !== 'number') {
    throw new Error('vellum:collections-delete: id must be a number')
  }
  deleteCollection(getDb(), id)
})

ipcMain.handle('vellum:collections-assign', (_event, params: unknown): void => {
  if (typeof params !== 'object' || params === null) {
    throw new Error('vellum:collections-assign: params must be an object')
  }
  const { paperSlug, collectionId } = params as { paperSlug: unknown; collectionId: unknown }
  if (typeof paperSlug !== 'string' || typeof collectionId !== 'number') {
    throw new Error('vellum:collections-assign: paperSlug must be string and collectionId must be number')
  }
  assignPaperToCollection(getDb(), { paperSlug, collectionId })
})

ipcMain.handle('vellum:collections-remove', (_event, params: unknown): void => {
  if (typeof params !== 'object' || params === null) {
    throw new Error('vellum:collections-remove: params must be an object')
  }
  const { paperSlug, collectionId } = params as { paperSlug: unknown; collectionId: unknown }
  if (typeof paperSlug !== 'string' || typeof collectionId !== 'number') {
    throw new Error('vellum:collections-remove: paperSlug must be string and collectionId must be number')
  }
  removePaperFromCollection(getDb(), { paperSlug, collectionId })
})

ipcMain.handle('vellum:collections-for-paper', (_event, paperSlug: unknown): CollectionRecord[] => {
  if (typeof paperSlug !== 'string') {
    throw new Error('vellum:collections-for-paper: paperSlug must be a string')
  }
  return listPaperCollections(getDb(), paperSlug)
})

// [L2-03] Paper-specific suggested questions IPC handlers
function parseQuestionsParams(slugOrParams: unknown, maybeBackend?: unknown): { slug: string; backend: string } {
  if (typeof slugOrParams === 'object' && slugOrParams !== null) {
    const candidate = slugOrParams as Record<string, unknown>
    const slug = requireSlug(candidate['slug'], 'vellum:questions')
    const backend = candidate['backend'] === 'codex' ? 'codex' : 'claude'
    return { slug, backend }
  }
  const slug = requireSlug(slugOrParams, 'vellum:questions')
  const backend = maybeBackend === 'codex' ? 'codex' : 'claude'
  return { slug, backend }
}

ipcMain.handle('vellum:questions-get', (_event, slugOrParams: unknown, maybeBackend?: unknown): SuggestedQuestionRecord[] => {
  const { slug, backend } = parseQuestionsParams(slugOrParams, maybeBackend)
  const db = getDb()
  const cached = getCachedQuestions(db, slug, backend)
  if (cached.length > 0) return cached

  const paper = getPaper(db, slug)
  if (!paper) return []

  const parsedSections = Array.isArray(paper.sections)
    ? (paper.sections as Array<{ title: string; page?: number }>)
    : []

  const generated = derivePaperQuestions({
    title: paper.title,
    abstract: paper.abstract,
    sections: parsedSections,
  })

  return saveSuggestedQuestions(db, slug, backend, generated)
})

ipcMain.handle('vellum:questions-regenerate', (_event, slugOrParams: unknown, maybeBackend?: unknown): SuggestedQuestionRecord[] => {
  const { slug, backend } = parseQuestionsParams(slugOrParams, maybeBackend)
  const db = getDb()
  clearSuggestedQuestions(db, slug, backend)

  const paper = getPaper(db, slug)
  if (!paper) return []

  const parsedSections = Array.isArray(paper.sections)
    ? (paper.sections as Array<{ title: string; page?: number }>)
    : []

  const generated = derivePaperQuestions({
    title: paper.title,
    abstract: paper.abstract,
    sections: parsedSections,
  })

  return saveSuggestedQuestions(db, slug, backend, generated)
})
