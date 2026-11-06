import type { VellumApi } from '../electron/preload'

// Makes the preload-exposed `window.vellum` API typed in the renderer,
// including the local File => disk path resolver (empty for files without disk backing).
declare global {
  interface Window {
    vellum: VellumApi
  }
}

export {}
