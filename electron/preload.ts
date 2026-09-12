import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AskOpenResult, AskStartParams, AskStreamEvent } from '../core/chat/manager.js'
import type { IngestResult } from '../core/ingest/index.js'
import type { ListPapersOptions, PaperRecord } from '../core/library/repo.js'
import type { NoteRecord } from '../core/notes/repo.js'
import type { HighlightRecord } from '../core/highlights/repo.js'
import type { AcpBackend } from '../core/acp/client.js'

export interface AskUpdatePayload {
  requestId: string
  event: AskStreamEvent
}

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
  // [P1-08] Library grid data — DB rows only (no file bytes). `options`
  // omitted = full list, most-recently-added first (core/library/repo.ts's
  // listPapers default).
  listPapers: (options?: ListPapersOptions): Promise<PaperRecord[]> =>
    ipcRenderer.invoke('vellum:list-papers', options ?? {}),
  getPaper: (slug: string): Promise<PaperRecord | null> => ipcRenderer.invoke('vellum:get-paper', slug),
  // [P2-01] Notes tab — one freeform markdown note per paper. `notesGet`
  // resolves null when the paper has no note yet (empty-editor state).
  // `notesSave` is autosave's persistence half — upsert-by-paper-slug, so the
  // renderer never juggles a note id.
  notesGet: (slug: string): Promise<NoteRecord | null> => ipcRenderer.invoke('vellum:notes-get', slug),
  notesSave: (params: { slug: string; body: string }): Promise<NoteRecord> =>
    ipcRenderer.invoke('vellum:notes-save', params),
  // Delete half of Notes CRUD — "Clear note" action.
  notesDelete: (slug: string): Promise<void> => ipcRenderer.invoke('vellum:notes-delete', slug),
  // [P2-02] Highlight tool + Annotations tab. `anchor` is an opaque JSON
  // string the renderer produces from the pdf.js text-layer selection (see
  // Reader.tsx's `anchorFromRange`/`rangeFromAnchor`) and consumes to
  // re-locate the highlight later — main/core never parse it.
  highlightsCreate: (params: {
    slug: string
    page: number
    color: string
    quote: string
    anchor: string
  }): Promise<HighlightRecord> => ipcRenderer.invoke('vellum:highlights-create', params),
  highlightsList: (slug: string): Promise<HighlightRecord[]> => ipcRenderer.invoke('vellum:highlights-list', slug),
  highlightsDelete: (id: string): Promise<void> => ipcRenderer.invoke('vellum:highlights-delete', id),
  // [P1-10] Ask tab — grounded chat over ACP. -----------------------------
  // Open (or reload) the most recent chat session + history for a paper.
  askOpen: (slug: string): Promise<AskOpenResult> => ipcRenderer.invoke('vellum:ask-open', slug),
  // "New chat": fresh session, empty history, fresh agent conversation.
  askNewChat: (params: { slug: string; backend: AcpBackend }): Promise<AskOpenResult> =>
    ipcRenderer.invoke('vellum:ask-new-chat', params),
  // Starts a turn; resolves immediately with a requestId once the turn is
  // *started* (not once it's done) — the reply streams over `onAskUpdate`.
  askStart: (params: AskStartParams): Promise<{ requestId: string }> =>
    ipcRenderer.invoke('vellum:ask-start', params),
  // Subscribes to every streamed Ask update; the renderer filters by
  // `requestId` (the one `askStart` returned) to route events to the right
  // in-flight turn. Returns an unsubscribe function.
  onAskUpdate: (callback: (payload: AskUpdatePayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: AskUpdatePayload): void => callback(payload)
    ipcRenderer.on('vellum:ask-update', listener)
    return () => ipcRenderer.removeListener('vellum:ask-update', listener)
  },
}

contextBridge.exposeInMainWorld('vellum', api)

export type VellumApi = typeof api
