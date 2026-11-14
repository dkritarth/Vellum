import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { pdfAssets } from './electron/pdfAssets'

// Single-package Electron layout:
//   electron/  -> main + preload (Node side)
//   src/       -> renderer (React UI)
//   core/      -> backend logic imported by the main process
export default defineConfig({
  main: {
    define: { __VELLUM_MAIN_BUNDLE__: 'true' },
    plugins: [
      pdfAssets(['standard_fonts']),
      externalizeDepsPlugin({
        exclude: ['@agentclientprotocol/sdk', 'unpdf', 'pdfjs-dist'],
      }),
    ],
    build: {
      rollupOptions: {
        input: resolve('electron/main.ts'),
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs',
        },
      },
    },
    resolve: {
      alias: { '@core': resolve('core') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react(), pdfAssets(['standard_fonts', 'wasm'])],
    resolve: {
      alias: { '@renderer': resolve('src') },
    },
    build: {
      rollupOptions: { input: resolve('src/index.html') },
    },
  },
})
