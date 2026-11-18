// Content gate for the packaged Apple Silicon app (issue #227).
//
// Usage: node scripts/check-package-contents.mjs <path/to/Vellum.app> [--cross-package]
//
// Fails when the app carries other-platform native binaries, dependency build
// sources, docs, videos, PDFs, or test data, or when a required runtime file
// (arm64 SQLite resource, canvas binary, dependency licenses) is missing.
// --cross-package is for `--dir` builds made on a non-Mac host, where npm
// never installed the darwin canvas binary, so its presence cannot be required.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE_EXT = /\.(node|dylib|so(\.\d+)*|dll|exe)$/i
const BUILD_SOURCE_EXT = /\.(c|cc|cpp|cxx|h|hpp|gyp|gypi)$/i
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
const MACHO_ARM64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01])

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

function walkDisk(dir, base = '') {
  const out = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.isDirectory() && dirent.name.endsWith('.lproj')) continue
    const rel = base ? `${base}/${dirent.name}` : dirent.name
    if (dirent.isDirectory()) out.push(...walkDisk(path.join(dir, dirent.name), rel))
    else out.push({ path: rel, size: fs.statSync(path.join(dir, dirent.name)).size })
  }
  return out
}

function isMachOArm64(file) {
  const head = Buffer.alloc(8)
  const fd = fs.openSync(file, 'r')
  try { fs.readSync(fd, head, 0, 8, 0) } finally { fs.closeSync(fd) }
  return head.equals(MACHO_ARM64)
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
  if (VIDEO_EXT.test(name)) reasons.push('video')
  if (/\.pdf$/i.test(name)) reasons.push('PDF (paper/test data)')
  if (dirs.some((d) => TEST_DIRS.has(d.toLowerCase())) || /\.(test|spec)\.[cm]?[jt]sx?(\.map)?$/.test(name)) {
    reasons.push('test data/support')
  }
  return reasons.map((reason) => `${where}: ${reason}`)
}

export function checkPackageContents(appBundle, { crossPackage = false } = {}) {
  const resources = path.join(appBundle, 'Contents', 'Resources')
  const violations = []
  if (!fs.existsSync(resources)) return { violations: [`${resources}: not found`], bytes: 0 }

  const entries = [] // { app: path inside the app payload, where: label, packed, disk? }
  const diskFiles = walkDisk(resources)
  let bytes = 0
  for (const file of diskFiles) {
    bytes += file.size
    if (file.path === 'app.asar') {
      for (const entry of readAsarEntries(path.join(resources, 'app.asar'))) {
        if (entry.unpacked) continue // listed on disk under app.asar.unpacked
        entries.push({ app: entry.path, where: `app.asar/${entry.path}`, packed: true })
      }
    } else if (file.path.startsWith('app.asar.unpacked/')) {
      entries.push({ app: file.path.slice('app.asar.unpacked/'.length), where: file.path, disk: file.path })
    } else {
      entries.push({ app: file.path, where: file.path, disk: file.path })
    }
  }

  for (const entry of entries) {
    const name = entry.app.split('/').pop()
    if (NATIVE_EXT.test(name)) {
      if (entry.packed) violations.push(`${entry.where}: native binary packed inside app.asar`)
      else if (!ALLOWED_NATIVE.some((re) => re.test(entry.app))) violations.push(`${entry.where}: unexpected native binary`)
      else if (!isMachOArm64(path.join(resources, entry.disk))) violations.push(`${entry.where}: not a Mach-O arm64 binary`)
    }
    violations.push(...contentViolations(entry.app, entry.where))
  }

  const present = new Set(entries.map((e) => e.app))
  const unpackedNative = entries.find((e) => e.app === 'native/better_sqlite3.node')
  if (!unpackedNative) violations.push('native/better_sqlite3.node: required arm64 SQLite resource is missing')
  for (const license of REQUIRED_LICENSES) {
    if (!present.has(license)) violations.push(`${license}: required license file is missing`)
  }
  if (!crossPackage && !entries.some((e) => ALLOWED_NATIVE[1].test(e.app))) {
    violations.push('node_modules/@napi-rs/canvas-darwin-arm64: required canvas binary is missing')
  }
  return { violations, bytes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--'))
  if (!target) {
    console.error('Usage: node scripts/check-package-contents.mjs <path/to/Vellum.app> [--cross-package]')
    process.exit(2)
  }
  const { violations, bytes } = checkPackageContents(path.resolve(target), { crossPackage: args.includes('--cross-package') })
  console.log(`Contents/Resources on disk: ${bytes} bytes`)
  if (violations.length) {
    console.error(`FAIL: ${violations.length} package content violation(s):`)
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }
  console.log('PASS: package contents match the arm64 allowlist')
}
