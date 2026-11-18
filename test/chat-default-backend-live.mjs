// Live check: a fresh install's first conversation uses Codex (the validated
// backend) and answers without the user switching models.
// Usage: xvfb-run -a node test/chat-default-backend-live.mjs /path/to/attention.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? '')
assert(fs.existsSync(pdf), `Missing PDF: ${pdf}`)
const evidence = path.join(ROOT, 'test-artifacts', 'chat-default-backend')
fs.mkdirSync(evidence, { recursive: true })
const { app, window, dataDir, consoleLines } = await launchIsolatedApp()
const button = (name) => window.getByRole('button', { name, exact: true })
try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 400_000 })
  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  const model = window.getByRole('combobox', { name: 'Model backend' })
  await window.waitForFunction(() => document.querySelector('select[aria-label="Model backend"]')?.value)
  const selected = await model.inputValue()
  console.log('default model backend:', selected)
  assert.equal(selected, 'codex')
  await window.getByRole('textbox', { name: 'Ask a question', exact: true }).fill('What architecture does this paper introduce? One sentence.')
  await button('Send').click()
  await window.waitForFunction(() => {
    const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
    const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
    return document.querySelector('[role=alert]') || (messages.length > 0 && messages.at(-1).textContent.length > 10 && !sending)
  }, null, { timeout: 240_000 })
  assert.equal(await window.getByRole('alert').count(), 0, 'answer without error')
  const answer = await window.locator('[class*=assistantMessage]').last().innerText()
  console.log('answer:', answer.slice(0, 160))
  assert.match(answer, /Transformer/i)
  await window.screenshot({ path: path.join(evidence, 'default-codex-answer.png') })
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: first conversation defaulted to Codex and answered; console clean')
} catch (error) {
  await captureFailureArtifacts('chat-default-backend', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(app, dataDir)
}
