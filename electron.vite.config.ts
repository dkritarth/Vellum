import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Single-package Electron layout:
//   electron/  -> main + preload (Node side)
//   src/       -> renderer (React UI)
//   core/      -> backend logic imported by the main process
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: resolve('electron/main.ts') },
    },
    resolve: {
      alias: { '@core': resolve('core') },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: resolve('electron/preload.ts') },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    resolve: {
      alias: { '@renderer': resolve('src') },
    },
    build: {
      rollupOptions: { input: resolve('src/index.html') },
    },
  },
})
