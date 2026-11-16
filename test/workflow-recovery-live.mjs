// Collection failure recovery and Trash/chat integrity in actual Electron.
// Only two failing IPC replies are injected; retries use production handlers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? path.join(ROOT, 'core/ingest/fixtures/sample.pdf'))
const evidence = path.join(ROOT, 'test-artifacts', 'workflow-recovery')
fs.mkdirSync(evidence, { recursive: true })
const { app, window, dataDir, consoleLines } = await launchIsolatedApp()
const button = (name) => window.getByRole('button', { name, exact: true })
try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 180_000 })
  await window.waitForFunction(() => document.querySelector('[data-text-layer]')?.textContent.length > 0)
  const title = await window.locator('[aria-label="Open papers"] [role=tab]').innerText()
  await button('Library').click()
  await button('New Collection').click()
  await window.keyboard.type('Recovery')
  await window.keyboard.press('Enter')
  const collection = window.getByRole('treeitem').filter({ hasText: 'Recovery' })
  await collection.waitFor()
  await button('Library').click()

  // Same test-only Electron 32 failure control used by notes-async-live.mjs.
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ['vellum:collections-assign', 'vellum:collections-remove']) {
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error(`Missing production handler ${channel}`)
      let fail = true
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (event, params) => {
        if (fail) {
          fail = false
          throw new Error('workflow-recovery controlled write failure')
        }
        return original(event, params)
      })
    }
  })
  const assign = window.getByRole('combobox', { name: `Add to collection: ${title}` })
  await assign.selectOption({ label: 'Recovery' })
  await window.getByRole('alert').filter({ hasText: `Could not add "${title}" to collection:` }).waitFor()
  assert.equal((await window.getByRole('alert').innerText()).includes('invoking remote method'), false)
  await window.screenshot({ path: path.join(evidence, 'assignment-error.png') })
  await assign.selectOption({ label: 'Recovery' })
  await window.getByRole('alert').waitFor({ state: 'detached' })
  await collection.click()
  const remove = button(`Remove from collection: ${title}`)
  await remove.click()
  await window.getByRole('alert').filter({ hasText: `Could not remove "${title}" from collection:` }).waitFor()
  await button(title).waitFor()
  await window.screenshot({ path: path.join(evidence, 'removal-error.png') })
  await remove.click()
  await window.getByText(/^No papers in this collection yet/).waitFor()
  await window.getByRole('alert').waitFor({ state: 'detached' })
  await button('Library').click()
  await button(`Move ${title} to trash`).click()
  await window.getByRole('tab', { name: 'Chats', exact: true }).click()
  const chat = window.getByRole('option').filter({ hasText: title }).first()
  await chat.click()
  await window.getByRole('alert').filter({ hasText: 'Restore it from Trash to open this conversation.' }).waitFor()
  assert.equal(await window.locator('[aria-label="Open papers"] [role=tab]').count(), 0)
  await window.screenshot({ path: path.join(evidence, 'trashed-chat-blocked.png') })
  await button('Trash').click()
  await button(`Restore ${title}`).click()
  await window.getByText('Trash is empty', { exact: true }).waitFor()
  await chat.click()
  await window.getByRole('tab', { name: title, exact: true }).waitFor()
  await window.getByRole('alert').waitFor({ state: 'detached' })
  await window.waitForFunction(() => document.querySelector('[data-text-layer]')?.textContent.length > 0)
  await window.screenshot({ path: path.join(evidence, 'restored-chat.png') })
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: visible collection errors/retries and Trash/chat restore boundary; console clean')
} catch (error) {
  await captureFailureArtifacts('workflow-recovery', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(app, dataDir)
}
