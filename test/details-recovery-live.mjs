// Metadata error recovery in real Electron. Only the failed reply is controlled;
// Retry uses the original production IPC handler and stored paper metadata.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? path.join(ROOT, 'core/ingest/fixtures/sample.pdf'))
const evidence = path.join(ROOT, 'test-artifacts', 'details-recovery')
fs.mkdirSync(evidence, { recursive: true })
const { app, window, dataDir, consoleLines } = await launchIsolatedApp()
try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await window.getByRole('button', { name: 'Create', exact: true }).click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 180_000 })
  await window.waitForFunction(() => document.querySelector('[data-text-layer]')?.textContent.length > 0)

  // Electron 32 test-only fault control, matching notes-async-live.mjs.
  // _invokeHandlers is private and never used by product code.
  await app.evaluate(({ ipcMain }) => {
    const channel = 'vellum:get-paper'
    const original = ipcMain._invokeHandlers.get(channel)
    if (!original) throw new Error('Missing metadata IPC handler')
    let fail = true
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, slug) => {
      if (fail) {
        fail = false
        throw new Error('details-recovery controlled metadata failure')
      }
      return original(event, slug)
    })
  })
  await window.getByRole('tab', { name: 'Details', exact: true }).click()
  await window.getByRole('alert').filter({ hasText: 'Could not load paper details.' }).waitFor()
  assert.equal(await window.getByText('Loading paper details…', { exact: true }).count(), 0)
  await window.screenshot({ path: path.join(evidence, 'error.png') })
  const retry = window.getByRole('button', { name: 'Retry', exact: true })
  await retry.focus()
  assert(await retry.evaluate((element) => document.activeElement === element))
  await window.keyboard.press('Enter')
  await window.locator('aside').getByRole('heading').first().waitFor()
  assert.equal(await window.getByRole('alert').count(), 0)
  await window.screenshot({ path: path.join(evidence, 'recovered.png') })
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: metadata failure exits loading; keyboard Retry restores production metadata')
} catch (error) {
  await captureFailureArtifacts('details-recovery', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(app, dataDir)
}
