import { contextBridge, ipcRenderer } from 'electron'
import type { IngestResult } from '../core/ingest/index.js'

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
  // [P1-06] Persist a paper end-to-end (files + DB row) via core/ingest.
  // `input` is a raw arXiv id/URL, DOI, PDF URL, or local PDF path —
  // core/ingest/classify.ts sorts out which. Rejects on failure (bad input,
  // network error, extract failure) rather than returning null.
  ingest: (input: string): Promise<IngestResult> => ipcRenderer.invoke('vellum:ingest', input),
}

contextBridge.exposeInMainWorld('vellum', api)

export type VellumApi = typeof api
