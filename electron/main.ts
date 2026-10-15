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
import { dirname, join, resolve } from 'node:path'
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

function resolveDataRoot(): string {
  const override = process.env['VELLUM_DATA_DIR'] ?? process.env['VELLUM_DATA_ROOT']
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(override.trim())
  }
  return resolve(process.cwd(), 'data')
}

// Preload the better-sqlite3 native addon under a canonical absolute path
// resolved from this module's directory (not process.cwd()). This ensures
// Node's module cache has the .node file registered before any later
// better-sqlite3 require, preventing the bindings package from falling back
// to process.cwd() during module-root detection (which fails when Electron
// is launched with a cwd other than the repo root).
const _nativeBindingPath = resolve(__dirname, '../resources/native/better_sqlite3.electron.node')
let _preloadedBetterSqlite3: ReturnType<typeof require> | undefined
try {
  _preloadedBetterSqlite3 = require(_nativeBindingPath)
} catch {
  // If the .node is missing (e.g. development without prebuilt binary),
  // we let openDb() handle the fallback via resolveNativeBinding().
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

  const pdfPath = join(resolveDataRoot(), 'papers', slug, 'paper.pdf')
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
// Uses the preloaded native binding (resolved from __dirname, not process.cwd())
// so the database works regardless of the cwd Electron was launched with.
let db: Database | undefined
function getDb(): Database {
  if (!db) db = openDb({ path: join(resolveDataRoot(), 'app.db'), nativeBinding: _preloadedBetterSqlite3 ? _nativeBindingPath : undefined })
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
  return ingest(input, { db: getDb(), dataDir: resolveDataRoot() })
})
