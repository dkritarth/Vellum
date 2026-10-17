// Deterministic Electron CI checks. Adapter executables are shadowed so this
// command never starts a signed-in model or depends on a developer account.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = mkdtempSync(join(tmpdir(), 'vellum-offline-'))
const bin = join(root, 'bin')
mkdirSync(bin)
for (const adapter of ['codex-acp', 'claude-code-acp']) {
  writeFileSync(join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
}

try {
  for (const gate of ['collections-live.mjs', 'trash-live.mjs', 'reading-gate.mjs', 'usage-live.mjs']) {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, gate)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_CACHE_HOME: join(root, 'cache'),
      },
      timeout: 120_000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${gate} failed (${result.signal ?? result.status})`)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
