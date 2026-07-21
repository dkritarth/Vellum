import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'

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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
