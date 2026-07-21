import { app, BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Database } from 'better-sqlite3'

import { StdioAcpClient } from '../core/acp/stdio-client.js'
import type { AskOpenResult, AskStartParams, AskStreamEvent } from '../core/chat/manager.js'
import type { AcpBackend } from '../core/acp/client.js'
import { ChatManager } from '../core/chat/manager.js'
import { getChatSession } from '../core/chat/repo.js'
import { ingest } from '../core/ingest/index.js'
import type { IngestResult } from '../core/ingest/index.js'
import { getPaper, listPapers } from '../core/library/repo.js'
import type { ListPapersOptions, PaperRecord, PaperSortColumn } from '../core/library/repo.js'
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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

// [P1-08] Library IPC seam. `options` arrives from the renderer as untyped
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

  return { search, sort, order }
}

// Library grid data [P1-08]. Read-only, no slug/path handling needed (unlike
// read-paper-file) — just forwards a sanitized query to the repo.
ipcMain.handle('vellum:list-papers', (_event, options: unknown): PaperRecord[] => {
  return listPapers(getDb(), toListPapersOptions(options))
})

ipcMain.handle('vellum:get-paper', (_event, slug: unknown): PaperRecord | null => {
  return getPaper(getDb(), requireSlug(slug, 'vellum:get-paper')) ?? null
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

// Open (or reload) the Ask tab for a paper: returns the most recent chat
// session for this slug + its full history, creating a fresh session if
// none exists yet. Cheap — never touches the ACP layer.
ipcMain.handle('vellum:ask-open', (_event, slug: unknown): AskOpenResult => {
  return getChatManager().openChat({ db: getDb(), paperSlug: requireSlug(slug, 'vellum:ask-open') })
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
