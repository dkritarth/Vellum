// Runs the actual packaged executable on the GitHub-hosted Apple Silicon Mac.
// No adapter sign-in is needed; this checks boot, SQLite, PDF and note persistence.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const executablePath = process.argv[2]
assert(executablePath && fs.existsSync(executablePath), 'Pass the packaged Vellum executable')
const screenshot = path.join(ROOT, 'test-artifacts', 'packaged-mac')
fs.mkdirSync(screenshot, { recursive: true })
let active
let dataDir
const logs = []
async function launch() {
  active = await launchIsolatedApp({ executablePath, dataDir })
  dataDir = active.dataDir
  await active.window.getByText('bridge: pong', { exact: true }).waitFor()
}
try {
  await launch()
  let window = active.window
  assert.deepEqual(await window.evaluate(() => window.vellum.listPapers({})), [])
  await window.getByRole('button', { name: 'Create', exact: true }).click()
  await window.getByLabel('Paper identifier or URL').fill(path.join(ROOT, 'core/ingest/fixtures/sample.pdf'))
  await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 60_000 })
  await window.waitForFunction(() => document.querySelector('canvas')?.width > 0 && document.querySelector('[data-text-layer]')?.textContent.length > 0)
  const title = await window.locator('[aria-label="Open papers"] [role=tab]').innerText()
  await window.getByRole('tab', { name: 'Notes', exact: true }).click()
  await window.getByRole('textbox', { name: 'Note', exact: true }).fill('Packaged Mac beta persistence check.')
  await window.getByText('Saved', { exact: true }).waitFor()
  await window.screenshot({ path: path.join(screenshot, 'before-restart.png') })
  logs.push(...active.consoleLines)
  await active.app.close()
  active = undefined
  await launch()
  window = active.window
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: title, exact: true }).click()
  await window.getByRole('tab', { name: 'Notes', exact: true }).click()
  await window.waitForFunction(() => document.querySelector('[aria-label="Note"]')?.value === 'Packaged Mac beta persistence check.')
  await window.screenshot({ path: path.join(screenshot, 'after-restart.png') })
  logs.push(...active.consoleLines)
  assertNoConsoleErrors(logs)
  console.log('PASS: packaged Mac boot, native SQLite, PDF/text layer, and note persistence')
} catch (error) {
  await captureFailureArtifacts('packaged-mac', { window: active?.window, consoleLines: [...logs, ...(active?.consoleLines ?? [])] })
  throw error
} finally {
  try { fs.writeFileSync(path.join(screenshot, 'console.log'), logs.join('\n')) }
  finally { await cleanupIsolatedApp(active?.app, dataDir) }
}
