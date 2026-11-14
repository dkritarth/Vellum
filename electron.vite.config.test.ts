import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('build ships matching PDF fonts, decoders, JS fallbacks and licenses beside each entry', () => {
  execFileSync(process.execPath, [resolve('node_modules/electron-vite/bin/electron-vite.js'), 'build'], { timeout: 60000, stdio: 'pipe' })
  for (const [output, directories] of [
    ['renderer', ['standard_fonts', 'wasm']],
    ['main', ['standard_fonts']],
  ] as const) {
    for (const directory of directories) {
      const source = resolve('node_modules/pdfjs-dist', directory)
      const target = resolve('out', output, 'pdfjs', directory)
      expect(readdirSync(target).sort()).toEqual(readdirSync(source).sort())
      for (const file of readdirSync(source)) {
        expect(readFileSync(resolve(target, file)).equals(readFileSync(resolve(source, file)))).toBe(true)
      }
    }
  }
}, 90000)
