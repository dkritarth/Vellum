// Opt-in, signed-in, real-paper check for #237: deleting the chat that is
// answering is refused with a friendly message, the conversation stays, and the
// answer still completes. Build first. Run under a desktop session or xvfb-run:
//   node test/delete-active-turn-live.mjs /path/to/paper.pdf [output-dir]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = process.argv[2] ? path.resolve(process.argv[2]) : ''
assert(pdf && fs.existsSync(pdf), 'Pass a real paper PDF, e.g. /tmp/vellum-papers/1706.03762.pdf')
const evidence = path.resolve(process.argv[3] ?? path.join(ROOT, 'test-artifacts', 'delete-active-turn'))
fs.mkdirSync(evidence, { recursive: true })

let active
let window
let passed = false
const mainLines = []
const button = (name) => window.getByRole('button', { name, exact: true })
const tab = (name) => window.getByRole('tab', { name, exact: true })

try {
  active = await launchIsolatedApp()
  window = active.window
  window.setDefaultTimeout(20_000)
  for (const stream of [active.app.process().stdout, active.app.process().stderr]) {
    stream?.on('data', (chunk) => mainLines.push(...String(chunk).split('\n').filter(Boolean)))
  }
  await window.getByText('bridge: pong', { exact: true }).waitFor()

  await window.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Create', exact: true }).click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 180_000 })
  await window.waitForFunction(() => document.querySelector('[data-page-number="1"] canvas')?.width > 0)

  await tab('Ask').click()
  await window.getByRole('combobox', { name: 'Model backend' }).selectOption('codex')
  const answers = window.locator('[class*=assistantMessage]')
  await window.getByRole('textbox', { name: 'Ask a question', exact: true })
    .fill('What architecture does this paper introduce? Cite a section.')
  await button('Send').click()
  await window.getByRole('button', { name: 'Sending…', exact: true }).waitFor()

  // Answer is streaming. Try to delete its conversation from the Chats tab.
  await tab('Chats').click()
  const row = window.getByRole('listbox', { name: 'Chat sessions' }).getByRole('option').first()
  await row.waitFor()
  const label = await row.getByRole('button', { name: /^Delete chat / }).getAttribute('aria-label')
  assert(label)
  window.once('dialog', (dialog) => dialog.accept())
  await button(label).click()
  const alert = window.getByRole('alert').first()
  await alert.waitFor()
  const message = await alert.innerText()
  console.log(`DELETE RESULT: ${message.replace(/\s+/g, ' ')}`)
  assert.match(message, /answer/i)
  assert.doesNotMatch(message, /SQLITE|FOREIGN KEY|CONSTRAINT|Error invoking/i)
  assert(await row.isVisible(), 'Conversation must remain listed after a refused delete')
  await window.screenshot({ path: path.join(evidence, 'refused.png') })

  // The answer must still finish and persist for the same conversation.
  await tab('Ask').click()
  await window.waitForFunction(() => {
    const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
    const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
    return messages.length > 0 && messages.at(-1).textContent.length > 10 && !sending
  }, undefined, { timeout: 240_000 })
  const answer = (await answers.last().innerText()).replace(/\s+/g, ' ')
  console.log(`ANSWER: ${answer.slice(0, 300)}`)
  assert.match(answer, /Transformer/i)

  // With the turn finished, the same delete succeeds.
  await tab('Chats').click()
  await row.waitFor()
  window.once('dialog', (dialog) => dialog.accept())
  await button(label).click()
  await button(label).waitFor({ state: 'detached' })
  await window.screenshot({ path: path.join(evidence, 'deleted-after.png') })

  const raw = mainLines.filter((line) => /SQLITE_CONSTRAINT|FOREIGN KEY/i.test(line))
  assert.equal(raw.length, 0, `Raw database error leaked to the main process log: ${raw[0]}`)
  assertNoConsoleErrors(active.consoleLines)
  console.log('console: clean; no SQLITE error in main log')
  passed = true
} catch (error) {
  console.error(error)
  if (window) await captureFailureArtifacts('delete-active-turn-live', { window, consoleLines: active?.consoleLines })
  console.error(`MAIN LOG (tail):\n${mainLines.slice(-15).join('\n')}`)
  process.exitCode = 1
} finally {
  if (active) await cleanupIsolatedApp(active.app, active.dataDir)
}
if (passed) console.log('PASS delete-active-turn-live')
