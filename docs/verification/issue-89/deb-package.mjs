// Inspect the generated installer without installing it or running maintainer scripts.
// Usage: node docs/verification/issue-89/deb-package.mjs release/vellum_0.1.0_amd64.deb
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const deb = resolve(process.argv[2] ?? 'release/vellum_0.1.0_amd64.deb')
const scratch = mkdtempSync(join(tmpdir(), 'vellum-deb-audit-'))
function run(command, args, input) {
  const result = spawnSync(command, args, { input, maxBuffer: 64 * 1024 * 1024 })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr?.toString()}`)
  return result.stdout
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
try {
  const metadata = run('dpkg-deb', ['--field', deb]).toString()
  assert.match(metadata, /^Package: vellum$/m)
  assert.match(metadata, /^Architecture: amd64$/m)
  const listing = run('dpkg-deb', ['--contents', deb]).toString()
  for (const file of ['vellum', 'chrome-sandbox', 'resources/app.asar', 'resources/native/better_sqlite3.node']) {
    const entry = listing.split('\n').find((line) => line.endsWith(` ./opt/Vellum/${file}`))
    assert(entry, `Installer missing ${file}`)
    assert.match(entry, / (?:root\/root|0\/0) /, `Installer must own ${file} as root`)
  }
  run('dpkg-deb', ['--extract', deb, join(scratch, 'payload')])
  run('dpkg-deb', ['--control', deb, join(scratch, 'control')])
  const installed = join(scratch, 'payload/opt/Vellum')
  const helperSha256 = hash(join(installed, 'chrome-sandbox'))
  assert.equal(helperSha256, hash('node_modules/electron/dist/chrome-sandbox'), 'Helper must match locked Electron distribution')
  assert.equal(hash(join(installed, 'resources/native/better_sqlite3.node')),
    hash('node_modules/better-sqlite3/build/Release/better_sqlite3.node'))
  const desktop = readFileSync(join(scratch, 'payload/usr/share/applications/vellum.desktop'), 'utf8')
  assert.match(desktop, /^Exec="?\/opt\/Vellum\/vellum"?(?: %U)?$/m)
  const postinst = readFileSync(join(scratch, 'control/postinst'), 'utf8')
  const postrm = readFileSync(join(scratch, 'control/postrm'), 'utf8')
  for (const script of [postinst, postrm]) {
    run('bash', ['-n'], script)
    assert(!/--no-sandbox|--disable-setuid-sandbox/.test(script), 'Installer must not bypass sandbox')
  }
  assert.match(postinst, /chmod 4755 '\/opt\/Vellum\/chrome-sandbox'/)
  console.log(JSON.stringify({ deb, helperSha256, desktop, metadata,
    result: 'Installer payload and hook audit passed. Extraction is not installation; default launch remains unverified.' }, null, 2))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
