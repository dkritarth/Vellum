import { contextBridge, ipcRenderer } from 'electron'

// Safe, typed bridge between the renderer (React UI) and the main process.
// Renderer never touches Node/Electron directly — only this allowlisted API.
// Extend `vellum` as IPC channels are added (ingest, library, chat/ACP, store).
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('vellum:ping'),
}

contextBridge.exposeInMainWorld('vellum', api)

export type VellumApi = typeof api
