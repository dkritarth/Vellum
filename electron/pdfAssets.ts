import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Ship resources from the renderer's installed PDF.js version, including licenses
 * and JS decoders needed when WebAssembly is unavailable under the existing CSP. */
export function pdfAssets(directories: readonly ('standard_fonts' | 'wasm')[]): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const assets = directories.flatMap((directory) =>
    readdirSync(resolve(root, directory)).map((file) => ({
      fileName: `pdfjs/${directory}/${file}`,
      source: readFileSync(resolve(root, directory, file)),
    })),
  )
  return {
    name: 'vellum-pdf-assets',
    generateBundle() {
      for (const asset of assets) this.emitFile({ type: 'asset', ...asset })
    },
    configureServer(server) {
      // Exact allowlist of package assets; never map request paths onto the filesystem.
      const routes = new Map(assets.map((asset) => [`/${asset.fileName}`, asset]))
      server.middlewares.use((request, response, next) => {
        const asset = routes.get((request.url ?? '').split('?')[0])
        if (!asset) return next()
        response.setHeader('Content-Type', asset.fileName.endsWith('.js')
          ? 'text/javascript' : asset.fileName.endsWith('.wasm')
            ? 'application/wasm' : 'application/octet-stream')
        response.end(asset.source)
      })
    },
  }
}
