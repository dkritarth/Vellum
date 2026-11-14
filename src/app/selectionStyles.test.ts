import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Electron 32 (Chromium 128) drops declarations that use CSS system colors it
// does not support, such as AccentColor. Inside a ::selection rule that
// leaves the selection invisible (#211), so selection colors must be literal.
const UNSUPPORTED_SYSTEM_COLORS = /\b(AccentColor|AccentColorText)\b/

describe('selection styles', () => {
  it('use colors Electron 32 can paint', () => {
    const dir = join(__dirname)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      const css = readFileSync(join(dir, file), 'utf8')
      for (const rule of css.matchAll(/[^{}]*::selection\s*\{([^}]*)\}/g)) {
        expect(rule[1], `${file}: ${rule[0].trim()}`).not.toMatch(UNSUPPORTED_SYSTEM_COLORS)
      }
    }
  })
})
