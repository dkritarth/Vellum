import type { VellumApi } from '../electron/preload'

// Makes the preload-exposed `window.vellum` API typed in the renderer.
declare global {
  interface Window {
    vellum: VellumApi
  }
}

export {}
