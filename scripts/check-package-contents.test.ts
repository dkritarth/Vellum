import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { checkPackageContents } from './check-package-contents.mjs'

const SCRIPT = resolve(__dirname, 'check-package-contents.mjs')

const MACHO_ARM64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01, 0, 0, 0, 0])
const MACHO_X64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01, 0, 0, 0, 0])
// Fat header: magic cafebabe (big-endian), nfat_arch, then 20-byte arch entries starting with cputype.
const CPU_ARM64 = 0x0100000c
const CPU_X64 = 0x01000007
const CPU_I386 = 0x00000007
function fat(...cpus: number[]) {
  const head = Buffer.alloc(8 + cpus.length * 20)
  head.writeUInt32BE(0xcafebabe, 0)
  head.writeUInt32BE(cpus.length, 4)
  cpus.forEach((cpu, i) => head.writeUInt32BE(cpu, 8 + i * 20))
  return head
}
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
  interface Node { files?: Record<string, Node>; size?: number; offset?: string; unpacked?: boolean }
  const header: Node = { files: {} }
  for (const entry of entries) {
    const unpacked = entry.startsWith('unpacked:')
    const parts = (unpacked ? entry.slice('unpacked:'.length) : entry).split('/')
    let dir = header.files as Record<string, Node>
    for (const part of parts.slice(0, -1)) {
      dir[part] ??= { files: {} }
      dir = dir[part].files as Record<string, Node>
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
  /** Files under Contents/Resources. */
  disk?: Record<string, Buffer | string>
  /** Files relative to Contents (Frameworks, MacOS, ...). */
  contents?: Record<string, Buffer | string>
}
function makeApp({ asar = [], disk = {}, contents = {} }: Options = {}) {
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
  for (const [rel, content] of Object.entries(contents)) {
    mkdirSync(dirname(join(app, 'Contents', rel)), { recursive: true })
    writeFileSync(join(app, 'Contents', rel), content)
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

  it('fails on source maps in the asar and on disk', () => {
    const violations = violationsFor({
      asar: ['node_modules/pdfjs-dist/build/pdf.mjs.map', 'node_modules/@agentclientprotocol/sdk/dist/acp.js.map', 'out/main/index.cjs.map'],
      disk: { 'app.asar.unpacked/node_modules/dep/x.js.map': '{}' },
    }).join('\n')
    expect(violations).toContain('pdf.mjs.map: source map')
    expect(violations).toContain('acp.js.map: source map')
    expect(violations).toContain('index.cjs.map: source map')
    expect(violations).toContain('dep/x.js.map: source map')
  })

  it('treats markdown-like docs case-insensitively but keeps license names', () => {
    const violations = violationsFor({
      asar: ['node_modules/a/Readme.markdown', 'node_modules/a/notes.RST', 'node_modules/a/ChangeLog', 'node_modules/a/LICENSE-MIT.md', 'node_modules/a/NOTICE.rst'],
    }).join('\n')
    expect(violations).toContain('Readme.markdown: documentation')
    expect(violations).toContain('notes.RST: documentation')
    expect(violations).toContain('ChangeLog: documentation')
    expect(violations).not.toContain('LICENSE-MIT.md')
    expect(violations).not.toContain('NOTICE.rst')
  })

  describe('whole-bundle walk', () => {
    it('accepts Electron-like Frameworks and MacOS content', () => {
      expect(violationsFor({
        contents: {
          'MacOS/Vellum': MACHO_ARM64,
          'Frameworks/Electron Framework.framework/Versions/A/Electron Framework': MACHO_ARM64,
          'Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib': MACHO_ARM64,
          'Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat': 'data',
          'Frameworks/Electron Framework.framework/Versions/A/Resources/chrome_100_percent.pak': 'pak',
          'Frameworks/Electron Framework.framework/Versions/A/Resources/en.lproj/locale.pak': 'pak',
          'Frameworks/Electron Framework.framework/Versions/A/Resources/LICENSE': 'MIT',
          'Frameworks/Electron Framework.framework/Versions/A/Resources/README.md': 'doc-like but not our payload',
          'Frameworks/Electron Framework.framework/Versions/A/Resources/test/data.bin': 'x',
          'Frameworks/Vellum Helper.app/Contents/MacOS/Vellum Helper': fat(CPU_ARM64),
          'Info.plist': '<plist/>',
        },
      })).toEqual([])
    })

    it('ignores symlinks inside frameworks', () => {
      const app = makeApp({ contents: { 'Frameworks/F.framework/Versions/A/F': MACHO_ARM64 } })
      symlinkSync('A', join(app, 'Contents/Frameworks/F.framework/Versions/Current'))
      symlinkSync('Versions/Current/F', join(app, 'Contents/Frameworks/F.framework/F'))
      expect((checkPackageContents(app) as { violations: string[] }).violations).toEqual([])
    })

    it('fails on non-arm64 Mach-O files regardless of extension or location', () => {
      const violations = violationsFor({
        contents: {
          'MacOS/Vellum': MACHO_X64,
          'Frameworks/F.framework/Versions/A/F': MACHO_X64,
          'Frameworks/F.framework/Versions/A/Libraries/libx.dylib': fat(CPU_X64),
          'Frameworks/Helper/tool': fat(CPU_ARM64, CPU_X64),
          'Frameworks/Helper/noextension': fat(CPU_I386),
          'Frameworks/Helper/thin-i386': Buffer.from([0xce, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 0, 0, 0, 0, 0]),
        },
        disk: { 'bin/helper': MACHO_X64 },
      }).join('\n')
      expect(violations).toContain('MacOS/Vellum: Mach-O binary contains x86_64 slice')
      expect(violations).toContain('Frameworks/F.framework/Versions/A/F: Mach-O binary contains x86_64 slice')
      expect(violations).toContain('libx.dylib: Mach-O binary contains x86_64 slice')
      expect(violations).toContain('Frameworks/Helper/thin-i386: Mach-O binary without arm64 slice')
      expect(violations).toContain('Frameworks/Helper/tool: Mach-O binary contains x86_64 slice')
      expect(violations).toContain('Frameworks/Helper/noextension: Mach-O binary without arm64 slice')
      expect(violations).toContain('Resources/bin/helper: Mach-O binary contains x86_64 slice')
    })

    it('does not mistake a Java class file for a fat Mach-O', () => {
      const classFile = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34, 0, 0, 0, 0])
      expect(violationsFor({ contents: { 'Frameworks/Tool.class': classFile } })).toEqual([])
    })

    it('fails on dSYM bundles anywhere', () => {
      const violations = violationsFor({
        contents: { 'Frameworks/F.framework.dSYM/Contents/Resources/DWARF/F': 'dwarf', 'MacOS/Vellum.dSYM/info': 'x' },
      }).join('\n')
      expect(violations).toContain('Frameworks/F.framework.dSYM/Contents/Resources/DWARF/F: debug symbols (.dSYM)')
      expect(violations).toContain('MacOS/Vellum.dSYM/info: debug symbols (.dSYM)')
    })
  })

  describe('CLI', () => {
    const run = (script: string, app: string, extra: string[] = []) =>
      spawnSync(process.execPath, [script, app, ...extra], { encoding: 'utf8' })

    it('exits non-zero with a FAIL line on a bad app tree', () => {
      const result = run(SCRIPT, makeApp({ asar: ['README.md'], disk: { 'native/extra.node': MACHO_X64 } }))
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/^FAIL: \d+ package content violation/m)
      expect(result.stderr).toContain('README.md: documentation')
    })

    it('fails closed when launched through a symlinked script path', () => {
      const dir = mkdtempSync(join(tmpdir(), 'vellum-pkg-gate-link-'))
      roots.push(dir)
      const link = join(dir, 'gate-link.mjs')
      symlinkSync(SCRIPT, link)
      const bad = run(link, makeApp({ asar: ['README.md'] }))
      expect(bad.status).toBe(1)
      expect(bad.stderr).toMatch(/^FAIL:/m)
      const good = run(link, makeApp())
      expect(good.status).toBe(0)
      expect(good.stdout).toContain('PASS')
    })

    it('exits 2 without an app path and 0 on a clean app', () => {
      expect(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status).toBe(2)
      const ok = run(SCRIPT, makeApp())
      expect(ok.status).toBe(0)
      expect(ok.stdout).toContain('PASS')
    })

    it('exits non-zero when the app bundle is missing', () => {
      const result = run(SCRIPT, join(tmpdir(), 'vellum-does-not-exist.app'))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    })
  })
})
