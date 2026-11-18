// Content gate for the packaged Apple Silicon app (issue #227).
//
// Usage: node scripts/check-package-contents.mjs <path/to/Vellum.app> [--cross-package]
//
// Walks all of Contents/ (Resources, Frameworks, MacOS, ...). Every file there
// must not be a non-arm64 Mach-O binary (any extension, thin or fat) or live in
// a .dSYM bundle. Contents/Resources (including the files inside app.asar) must
// also be free of other-platform native binaries, dependency build sources,
// docs, source maps, videos, PDFs, and test data, and must keep the required
// runtime files (arm64 SQLite resource, canvas binary, dependency licenses).
// The Electron Frameworks legitimately ship docs-like files and many binaries,
// so the content rules apply to Contents/Resources only.
// --cross-package is for `--dir` builds made on a non-Mac host, where npm
// never installed the darwin canvas binary, so its presence cannot be required.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE_EXT = /\.(node|dylib|so(\.\d+)*|dll|exe)$/i
const BUILD_SOURCE_EXT = /\.(c|cc|cpp|cxx|h|hpp|gyp|gypi)$/i
const SOURCE_MAP_EXT = /\.map$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'testdata', 'test-data', 'test-support', 'examples'])
const LICENSE_NAME = /^(licen[sc]e|notice|copying)([.-].*)?$/i
const ALLOWED_NATIVE = [
  /^native\/better_sqlite3\.node$/,
  /(^|\/)node_modules\/@napi-rs\/canvas-darwin-arm64\/[^/]+\.node$/,
]
const REQUIRED_LICENSES = [
  'node_modules/better-sqlite3/LICENSE',
  'node_modules/@napi-rs/canvas/LICENSE',
  'node_modules/pdfjs-dist/LICENSE',
]
const CPU_ARM64 = 0x0100000c
const CPU_X86_64 = 0x01000007

/** Reads the file table of an asar archive without extracting it. */
export function readAsarEntries(archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(16)
    fs.readSync(fd, prefix, 0, 16, 0)
    const jsonLength = prefix.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    fs.readSync(fd, json, 0, jsonLength, 16)
    const entries = []
    const walk = (node, base) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const rel = base ? `${base}/${name}` : name
        if (child.files) walk(child, rel)
        else entries.push({ path: rel, unpacked: Boolean(child.unpacked), size: Number(child.size ?? 0) })
      }
    }
    walk(JSON.parse(json.toString('utf8')), '')
    return entries
  } finally {
    fs.closeSync(fd)
  }
}

/** Walks a directory without following symlinks. Paths are relative to `dir`. */
function walkDisk(dir, base = '') {
  const out = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory() && dirent.name.endsWith('.lproj')) continue
    const rel = base ? `${base}/${dirent.name}` : dirent.name
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory()) out.push(...walkDisk(full, rel))
    else if (dirent.isFile()) out.push({ path: rel, size: fs.statSync(full).size })
  }
  return out
}

/**
 * CPU types of a Mach-O file (thin or fat), or null when the file is not Mach-O.
 * Reads only the header. Java class files share the fat magic, so a fat header
 * claiming more than 30 slices is treated as not Mach-O.
 */
function machOCpuTypes(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    const read = fs.readSync(fd, head, 0, 16, 0)
    if (read < 8) return null
    const magic = head.readUInt32BE(0)
    if (magic === 0xcffaedfe || magic === 0xcefaedfe) return [head.readUInt32LE(4)] // thin, little-endian
    if (magic === 0xfeedfacf || magic === 0xfeedface) return [head.readUInt32BE(4)] // thin, big-endian
    const fatBE = magic === 0xcafebabe || magic === 0xcafebabf
    const fatLE = magic === 0xbebafeca || magic === 0xbfbafeca
    if (!fatBE && !fatLE) return null
    const readU32 = (buf, offset) => (fatBE ? buf.readUInt32BE(offset) : buf.readUInt32LE(offset))
    const count = readU32(head, 4)
    if (count < 1 || count > 30) return null
    const entrySize = magic === 0xcafebabf || magic === 0xbfbafeca ? 32 : 20
    const table = Buffer.alloc(count * entrySize)
    const got = fs.readSync(fd, table, 0, table.length, 8)
    if (got < table.length) return null
    return Array.from({ length: count }, (_, i) => readU32(table, i * entrySize))
  } finally {
    fs.closeSync(fd)
  }
}

function contentViolations(appPath, where) {
  const reasons = []
  const parts = appPath.split('/')
  const name = parts[parts.length - 1]
  const dirs = parts.slice(0, -1)
  const isLicense = LICENSE_NAME.test(name)
  if (/(^|\/)node_modules\/better-sqlite3\/(prebuilds|deps|src|build)\//.test(appPath) || /(^|\/)better-sqlite3\/binding\.gyp$/.test(appPath)) {
    reasons.push('better-sqlite3 prebuild/build source (app loads resources/native/better_sqlite3.node)')
  } else if (BUILD_SOURCE_EXT.test(name)) {
    reasons.push('C/C++ build source')
  }
  if (!isLicense && (/\.(md|markdown|rst)$/i.test(name) || /^(readme|changelog|history|code_of_conduct)/i.test(name) || dirs.includes('docs'))) {
    reasons.push('documentation')
  }
  if (SOURCE_MAP_EXT.test(name)) reasons.push('source map')
  if (VIDEO_EXT.test(name)) reasons.push('video')
  if (/\.pdf$/i.test(name)) reasons.push('PDF (paper/test data)')
  if (dirs.some((d) => TEST_DIRS.has(d.toLowerCase())) || /\.(test|spec)\.[cm]?[jt]sx?(\.map)?$/.test(name)) {
    reasons.push('test data/support')
  }
  return reasons.map((reason) => `${where}: ${reason}`)
}

export function checkPackageContents(appBundle, { crossPackage = false } = {}) {
  const contents = path.join(appBundle, 'Contents')
  const violations = []
  if (!fs.existsSync(path.join(contents, 'Resources'))) return { violations: [`${path.join(contents, 'Resources')}: not found`], bytes: 0, resourceBytes: 0 }

  // Payload entries under Contents/Resources. app: path inside the app payload
  // (asar contents and app.asar.unpacked share one namespace); where: report label.
  const payload = []
  let bytes = 0
  let resourceBytes = 0
  for (const file of walkDisk(contents)) {
    bytes += file.size
    const onDisk = path.join(contents, file.path)

    if (file.path.split('/').some((part) => /\.dSYM$/i.test(part))) {
      violations.push(`${file.path}: debug symbols (.dSYM)`)
      continue
    }

    const cpus = machOCpuTypes(onDisk)
    const isResource = file.path.startsWith('Resources/')
    const resourcePath = isResource ? file.path.slice('Resources/'.length) : ''
    const allowedNative = isResource && ALLOWED_NATIVE.some((re) => re.test(unpackedName(resourcePath)))
    if (allowedNative) {
      if (!cpus || cpus.length !== 1 || cpus[0] !== CPU_ARM64) violations.push(`${file.path}: not a Mach-O arm64 binary`)
    } else if (cpus) {
      if (cpus.includes(CPU_X86_64)) violations.push(`${file.path}: Mach-O binary contains x86_64 slice`)
      else if (!cpus.includes(CPU_ARM64)) violations.push(`${file.path}: Mach-O binary without arm64 slice`)
    }

    if (!isResource) continue
    resourceBytes += file.size
    if (resourcePath === 'app.asar') {
      for (const entry of readAsarEntries(onDisk)) {
        if (entry.unpacked) continue // listed on disk under app.asar.unpacked
        payload.push({ app: entry.path, where: `Resources/app.asar/${entry.path}`, packed: true })
      }
    } else {
      payload.push({ app: unpackedName(resourcePath), where: file.path, allowedNative })
    }
  }

  for (const entry of payload) {
    const name = entry.app.split('/').pop()
    if (NATIVE_EXT.test(name)) {
      if (entry.packed) violations.push(`${entry.where}: native binary packed inside app.asar`)
      else if (!entry.allowedNative) violations.push(`${entry.where}: unexpected native binary`)
    }
    violations.push(...contentViolations(entry.app, entry.where))
  }

  const present = new Set(payload.map((e) => e.app))
  if (!payload.some((e) => e.app === 'native/better_sqlite3.node')) violations.push('native/better_sqlite3.node: required arm64 SQLite resource is missing')
  for (const license of REQUIRED_LICENSES) {
    if (!present.has(license)) violations.push(`${license}: required license file is missing`)
  }
  if (!crossPackage && !payload.some((e) => ALLOWED_NATIVE[1].test(e.app))) {
    violations.push('node_modules/@napi-rs/canvas-darwin-arm64: required canvas binary is missing')
  }
  return { violations, bytes, resourceBytes }
}

/** Maps a Resources-relative disk path to its path inside the app payload. */
function unpackedName(resourcePath) {
  return resourcePath.startsWith('app.asar.unpacked/') ? resourcePath.slice('app.asar.unpacked/'.length) : resourcePath
}

export function main(argv) {
  const target = argv.find((a) => !a.startsWith('--'))
  if (!target) {
    console.error('Usage: node scripts/check-package-contents.mjs <path/to/Vellum.app> [--cross-package]')
    return 2
  }
  const { violations, bytes, resourceBytes } = checkPackageContents(path.resolve(target), { crossPackage: argv.includes('--cross-package') })
  console.log(`Contents on disk: ${bytes} bytes (Resources: ${resourceBytes} bytes)`)
  if (violations.length) {
    console.error(`FAIL: ${violations.length} package content violation(s):`)
    for (const v of violations) console.error(`  - ${v}`)
    return 1
  }
  console.log('PASS: package contents match the arm64 allowlist')
  return 0
}

// Compare real paths: a symlinked invocation (npx, package-manager shims) must
// still run the gate, otherwise it would exit 0 without checking anything.
function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) process.exitCode = main(process.argv.slice(2))
