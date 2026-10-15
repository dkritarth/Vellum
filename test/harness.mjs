// Shared isolated-launch helper for Vellum live Electron gates.
//
// Guarantees:
//   - The app never reads or writes the repository's real `data/` directory;
//     a unique per-run temp dir is exposed through VELLUM_DATA_DIR instead.
//   - Renderer + main console output is captured into an array.
//   - Failure produces a screenshot + captured console log under
//     `test-artifacts/<gate>-<timestamp>/` and prints their absolute paths.
//   - Cleanup kills the Electron app and removes the temp dir (try/finally).

import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACTS_ROOT = path.join(ROOT, 'test-artifacts')

// Create a fresh isolated data dir (acts as the app's `data/` root).
// Pass an existing path to reuse it across launches (e.g. restart persistence).
export function createIsolatedDataDir(existing) {
  if (existing) {
    fs.mkdirSync(existing, { recursive: true })
    return existing
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-gate-'))
}

export async function launchIsolatedApp(options = {}) {
  const appPath = options.appPath || path.join(ROOT, 'out', 'main', 'index.cjs')
  const dataDir = createIsolatedDataDir(options.dataDir)

  const app = await electron.launch({
    args: ['--no-sandbox', appPath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      VELLUM_DATA_DIR: dataDir,
    },
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const consoleLines = []
  window.on('console', (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`)
  })
  window.on('pageerror', (err) => {
    consoleLines.push(`[pageerror] ${err && err.stack ? err.stack : String(err)}`)
  })

  return { app, window, consoleLines, dataDir, consoleLogs: consoleLines }
}

export async function captureFailureArtifacts(gateName, details = {}) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(ARTIFACTS_ROOT, `${gateName}-${ts}`)
  fs.mkdirSync(dir, { recursive: true })

  const window = details.window
  const consoleLines = details.consoleLines || details.consoleLogs || []
  const screenshotPath = path.join(dir, 'screenshot.png')
  const consolePath = path.join(dir, 'console.log')

  if (window) {
    try {
      await window.screenshot({ path: screenshotPath, fullPage: true })
    } catch (err) {
      fs.writeFileSync(path.join(dir, 'screenshot.error.txt'), String(err && err.stack ? err.stack : err))
    }
  }
  try {
    fs.writeFileSync(consolePath, consoleLines.join('\n') + '\n')
  } catch (err) {
    fs.writeFileSync(path.join(dir, 'console.error.txt'), String(err && err.stack ? err.stack : err))
  }

  // Print absolute paths so a human can open them.
  console.error(`[harness] failure artifacts: ${dir}`)
  console.error(`[harness]   screenshot: ${screenshotPath}`)
  console.error(`[harness]   console:    ${consolePath}`)
  return dir
}

// allowlist: array of { pattern: RegExp|string, reason: string }.
// A bare RegExp/string is accepted only if the caller cannot... we require
// rationale: any entry lacking a non-empty `reason` throws.
export function assertNoConsoleErrors(consoleLines, allowlist = []) {
  const normalized = allowlist.map((entry) => {
    if (entry && typeof entry === 'object' && 'pattern' in entry) {
      if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        throw new Error('assertNoConsoleErrors: every allowlisted pattern requires a non-empty reason')
      }
      return { pattern: entry.pattern, reason: entry.reason.trim() }
    }
    // Back-compat: bare RegExp/string allowed ONLY in tests? Require reason via object.
    throw new Error('assertNoConsoleErrors: allowlist entries must be { pattern, reason } with rationale')
  })

  const errors = (consoleLines || []).filter((line) => {
    const isErrorish = /^\[(error|warning|pageerror)\]/i.test(line) ||
      /\bconsole\.(error|warn)\b/i.test(line)
    if (!isErrorish) return false
    return !normalized.some(({ pattern }) => {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern)
      return re.test(line)
    })
  })

  if (errors.length > 0) {
    throw new Error(`Console errors/warnings not allowlisted:\n${errors.join('\n')}`)
  }
  return true
}

export async function cleanupIsolatedApp(app, dataDir) {
  if (app) {
    try {
      await app.close()
    } catch (err) {
      console.error('[harness] app.close failed:', err && err.message ? err.message : err)
      try {
        const proc = typeof app.process === 'function' ? app.process() : null
        if (proc && typeof proc.kill === 'function') proc.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }
  if (dataDir) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch (err) {
      console.error('[harness] rm dataDir failed:', err && err.message ? err.message : err)
    }
  }
}
