// Linux regression: gate profiles are independent, but survive a gate restart.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  launchIsolatedApp,
  cleanupIsolatedApp,
  captureFailureArtifacts,
  assertNoConsoleErrors,
} from './harness.mjs'

if (process.platform !== 'linux') {
  console.log('SKIP: XDG profile isolation applies to Linux only')
  process.exit(0)
}

// Protect the developer profile even when running against the broken harness.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-profile-regression-'))
process.env.XDG_CONFIG_HOME = path.join(root, 'parent-config')
process.env.XDG_CACHE_HOME = path.join(root, 'parent-cache')
let launched
const consoleLines = []
async function launch(dataDir) {
  launched = await launchIsolatedApp({ dataDir })
  await launched.window.getByText('bridge: pong', { exact: true }).waitFor()
  return launched.window
}
async function close() {
  consoleLines.push(...launched.consoleLines)
  await launched.app.close()
  launched = undefined
}

try {
  let window = await launch(path.join(root, 'first'))
  await window.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await window.getByRole('button', { name: 'Show sidebar', exact: true }).waitFor()
  assert.equal(await window.getByRole('navigation', { name: 'Primary' }).isVisible(), false)
  await close()

  window = await launch(path.join(root, 'first'))
  await window.getByRole('button', { name: 'Show sidebar', exact: true }).waitFor()
  assert.equal(await window.getByRole('navigation', { name: 'Primary' }).isVisible(), false,
    'Restart must retain the collapsed sidebar')
  await close()

  window = await launch(path.join(root, 'second'))
  assert.equal(await window.getByRole('navigation', { name: 'Primary' }).isVisible(), true,
    'Fresh gate must not inherit the previous gate\'s collapsed sidebar')
  await window.getByRole('button', { name: 'Hide sidebar', exact: true }).waitFor()
  await close()
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: same-directory restart retains layout; fresh directory starts with visible sidebar')
} catch (error) {
  await captureFailureArtifacts('harness-isolation', {
    window: launched?.window,
    consoleLines: [...consoleLines, ...(launched?.consoleLines ?? [])],
  })
  throw error
} finally {
  await cleanupIsolatedApp(launched?.app, root)
}
