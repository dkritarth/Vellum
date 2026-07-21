import { contextBridge, ipcRenderer } from 'electron'

// Safe, typed bridge between the renderer (React UI) and the main process.
// Renderer never touches Node/Electron directly — only this allowlisted API.
// Extend `vellum` as IPC channels are added (ingest, library, chat/ACP, store).
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('vellum:ping'),
  // [P1-09] Reader needs raw PDF bytes for a paper. Main process reads
  // data/papers/<slug>/paper.pdf and hands back an ArrayBuffer (or null if
  // the slug/file doesn't exist) — the renderer never touches fs directly.
  readPaperFile: (slug: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('vellum:read-paper-file', slug),
}

contextBridge.exposeInMainWorld('vellum', api)

export type VellumApi = typeof api
