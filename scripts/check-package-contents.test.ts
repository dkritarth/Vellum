import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
// @ts-expect-error plain ESM script without type declarations
import { checkPackageContents } from './check-package-contents.mjs'

const MACHO_ARM64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01, 0, 0, 0, 0])
const MACHO_X64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01, 0, 0, 0, 0])
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0])

const BASE_ASAR = [
  'out/main/index.cjs',
  'package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/better-sqlite3/LICENSE',
  'node_modules/@napi-rs/canvas/LICENSE',
  'node_modules/pdfjs-dist/LICENSE',
  'node_modules/node-addon-api/LICENSE.md',
]

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

// Minimal asar writer: a pickled JSON header is all the gate reads.
function writeAsar(file: string, entries: string[]) {
  const header: { files: Record<string, unknown> } = { files: {} }
  for (const entry of entries) {
    const unpacked = entry.startsWith('unpacked:')
    const parts = (unpacked ? entry.slice('unpacked:'.length) : entry).split('/')
    let dir = header.files as Record<string, { files?: Record<string, unknown> }>
    for (const part of parts.slice(0, -1)) {
      dir[part] ??= { files: {} }
      dir = dir[part].files as typeof dir
    }
    dir[parts[parts.length - 1]] = unpacked ? { size: 1, unpacked: true } : { size: 1, offset: '0' }
  }
  const json = Buffer.from(JSON.stringify(header))
  const padded = Math.ceil(json.length / 4) * 4
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(padded + 8, 4)
  prefix.writeUInt32LE(padded + 4, 8)
  prefix.writeUInt32LE(json.length, 12)
  writeFileSync(file, Buffer.concat([prefix, json, Buffer.alloc(padded - json.length)]))
}

interface Options {
  asar?: string[]
  disk?: Record<string, Buffer | string>
}
function makeApp({ asar = [], disk = {} }: Options = {}) {
  const app = join(mkdtempSync(join(tmpdir(), 'vellum-pkg-gate-')), 'Vellum.app')
  roots.push(dirname(app))
  const resources = join(app, 'Contents', 'Resources')
  mkdirSync(join(resources, 'en.lproj'), { recursive: true })
  writeAsar(join(resources, 'app.asar'), [...BASE_ASAR, ...asar])
  const files: Record<string, Buffer | string> = {
    'native/better_sqlite3.node': MACHO_ARM64,
    'app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node': MACHO_ARM64,
    'en.lproj/ignored.md': 'locale folders are skipped',
    ...disk,
  }
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(resources, rel)), { recursive: true })
    writeFileSync(join(resources, rel), content)
  }
  return app
}
const violationsFor = (options?: Options, check?: { crossPackage?: boolean }) =>
  (checkPackageContents(makeApp(options), check) as { violations: string[] }).violations

describe('check-package-contents', () => {
  it('accepts the trimmed arm64 layout', () => {
    expect(violationsFor()).toEqual([])
  })

  it('fails on other-platform better-sqlite3 prebuilds and build sources', () => {
    const base = 'app.asar.unpacked/node_modules/better-sqlite3'
    const violations = violationsFor({
      disk: {
        [`${base}/prebuilds/darwin-x64.node`]: MACHO_X64,
        [`${base}/prebuilds/linux-x64.node`]: ELF,
        [`${base}/prebuilds/win32-x64.node`]: 'MZ',
        [`${base}/deps/sqlite3/sqlite3.c`]: 'int x;',
        [`${base}/src/addon.cpp`]: 'int x;',
        [`${base}/binding.gyp`]: '{}',
      },
    }).join('\n')
    expect(violations).toContain('prebuilds/darwin-x64.node: unexpected native binary')
    expect(violations).toContain('prebuilds/linux-x64.node: unexpected native binary')
    expect(violations).toContain('prebuilds/win32-x64.node: unexpected native binary')
    expect(violations).toContain('deps/sqlite3/sqlite3.c: better-sqlite3 prebuild/build source')
    expect(violations).toContain('src/addon.cpp: better-sqlite3 prebuild/build source')
    expect(violations).toContain('binding.gyp: better-sqlite3 prebuild/build source')
  })

  it('fails on a non-arm64 binary at an allowed path', () => {
    expect(violationsFor({ disk: { 'native/better_sqlite3.node': MACHO_X64 } }).join('\n'))
      .toContain('native/better_sqlite3.node: not a Mach-O arm64 binary')
    expect(violationsFor({ disk: { 'native/better_sqlite3.node': ELF } }).join('\n'))
      .toContain('not a Mach-O arm64 binary')
  })

  it('fails on other-platform canvas binaries and native code packed in the asar', () => {
    const violations = violationsFor({
      asar: ['node_modules/foo/bin.node', 'node_modules/@napi-rs/canvas-linux-x64-gnu/skia.node'],
      disk: { 'app.asar.unpacked/node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node': ELF },
    }).join('\n')
    expect(violations).toContain('canvas-linux-x64-gnu/skia.linux-x64-gnu.node: unexpected native binary')
    expect(violations).toContain('app.asar/node_modules/foo/bin.node: native binary packed inside app.asar')
  })

  it('fails on docs, videos, PDFs, and test data but keeps license files', () => {
    const violations = violationsFor({
      asar: [
        'README.md',
        'docs/evidence/shot.png',
        'node_modules/dep/CHANGELOG.md',
        'node_modules/dep/CODE_OF_CONDUCT.md',
        'media/walkthrough.mp4',
        'core/ingest/fixtures/sample.pdf',
        'node_modules/dep/dist/thing.test.js',
        'node_modules/dep/test/data.json',
        'node_modules/dep/LICENSE.md',
      ],
    }).join('\n')
    for (const bad of ['README.md: documentation', 'docs/evidence/shot.png: documentation', 'CHANGELOG.md: documentation',
      'CODE_OF_CONDUCT.md: documentation', 'walkthrough.mp4: video', 'sample.pdf: PDF', 'thing.test.js: test data',
      'test/data.json: test data']) {
      expect(violations).toContain(bad)
    }
    expect(violations).not.toContain('LICENSE.md')
    expect(violations).not.toContain('node-addon-api/LICENSE.md')
  })

  it('fails when required runtime files are missing', () => {
    const app = makeApp()
    rmSync(join(app, 'Contents/Resources/native/better_sqlite3.node'))
    rmSync(join(app, 'Contents/Resources/app.asar.unpacked'), { recursive: true })
    const { violations } = checkPackageContents(app) as { violations: string[] }
    expect(violations.join('\n')).toContain('native/better_sqlite3.node: required arm64 SQLite resource is missing')
    expect(violations.join('\n')).toContain('canvas-darwin-arm64: required canvas binary is missing')
    // A non-Mac --dir build cannot contain the darwin canvas binary.
    const cross = checkPackageContents(app, { crossPackage: true }) as { violations: string[] }
    expect(cross.violations.join('\n')).not.toContain('canvas-darwin-arm64')
  })

  it('fails when a retained dependency license is dropped', () => {
    const app = makeApp()
    writeAsar(join(app, 'Contents/Resources/app.asar'), BASE_ASAR.filter((e) => !e.endsWith('better-sqlite3/LICENSE')))
    const { violations } = checkPackageContents(app) as { violations: string[] }
    expect(violations).toContain('node_modules/better-sqlite3/LICENSE: required license file is missing')
  })
})
