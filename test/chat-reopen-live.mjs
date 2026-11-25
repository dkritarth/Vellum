// Live check for #258: coming back to a paper (tab switch or restart) shows
// the conversation the user last wrote in, not the newest-created one.
// Needs signed-in Codex (the answers themselves do not matter).
// Usage: xvfb-run -a node test/chat-reopen-live.mjs /path/attention.pdf /path/second-paper.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdfs = process.argv.slice(2, 4).map((file) => path.resolve(file))
for (const pdf of pdfs) assert(fs.existsSync(pdf), `Missing PDF: ${pdf}`)
assert.equal(pdfs.length, 2, 'two PDFs required')
const evidence = path.join(ROOT, 'test-artifacts', 'chat-reopen')
fs.mkdirSync(evidence, { recursive: true })

let active = await launchIsolatedApp()
const dataDir = active.dataDir
const consoleLines = []
let window = active.window
const button = (name) => window.getByRole('button', { name, exact: true })
const paperTabs = () => window.locator('[aria-label="Open papers"] [role=tab]')
const thread = () => window.evaluate(() => [...document.querySelectorAll('[class*=userMessage],[class*=assistantMessage]')]
  .map((element) => element.innerText.trim()).join('\n'))

async function ingest(pdf) {
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 400_000 })
}

async function ask(text) {
  const before = await window.locator('[class*=assistantMessage]').count()
  await window.getByRole('textbox', { name: 'Ask a question', exact: true }).fill(text)
  await button('Send').click()
  await window.waitForFunction((count) => {
    const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
    const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
    return document.querySelector('[role=alert]') || (messages.length > count && messages.at(-1).textContent.trim().length > 0 && !sending)
  }, before, { timeout: 240_000 })
  assert.equal(await window.getByRole('alert').count(), 0, `answer to "${text}" without error`)
}

try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await ingest(pdfs[0])
  await ingest(pdfs[1])
  assert.equal(await paperTabs().count(), 2)
  const [titleA, titleB] = [await paperTabs().nth(0).innerText(), await paperTabs().nth(1).innerText()].map((t) => t.replace(/×$/, '').trim())

  // Chat A on the first paper.
  await paperTabs().nth(0).click()
  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await window.getByRole('combobox', { name: 'Model backend' }).selectOption('codex')
  await ask('Reply with exactly the single word ALPHA.')

  // New chat (B, empty), then back to A from the Chats list, and ask there.
  await button('New chat').click()
  await window.waitForFunction(() => document.querySelectorAll('[class*=assistantMessage]').length === 0)
  await window.getByRole('tab', { name: 'Chats', exact: true }).click()
  const chatA = window.getByRole('option').filter({ hasText: titleA }).filter({ hasNotText: /(^|\D)0 turns?/ })
  await chatA.first().click()
  await window.waitForFunction(() => document.body.innerText.includes('ALPHA'))
  await ask('Reply with exactly the single word BRAVO.')
  console.log('PASS chat A used after New chat')

  // Tab switch away and back: Ask shows A (with BRAVO), not empty B.
  await paperTabs().nth(1).click()
  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await paperTabs().nth(0).click()
  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await window.waitForFunction(() => document.querySelectorAll('[class*=userMessage]').length > 0, null, { timeout: 15_000 })
  const afterSwitch = await thread()
  assert.match(afterSwitch, /BRAVO/, `after a tab switch Ask must show chat A:\n${afterSwitch}`)
  await window.screenshot({ path: path.join(evidence, 'after-tab-switch.png') })
  console.log('PASS tab switch reopens the last used chat')

  // Restart with the same data: opening the paper shows chat A again.
  consoleLines.push(...active.consoleLines)
  await active.app.close()
  active = await launchIsolatedApp({ dataDir })
  window = active.window
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await window.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Library', exact: true }).click()
  await button(titleA).click()
  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await window.waitForFunction(() => document.querySelectorAll('[class*=userMessage]').length > 0, null, { timeout: 15_000 })
  const afterRestart = await thread()
  assert.match(afterRestart, /BRAVO/, `after restart Ask must show chat A:\n${afterRestart}`)
  await window.screenshot({ path: path.join(evidence, 'after-restart.png') })
  console.log(`PASS restart reopens the last used chat (${titleA}; other paper ${titleB})`)

  consoleLines.push(...active.consoleLines)
  assertNoConsoleErrors(consoleLines)
  console.log('PASS console clean')
} catch (error) {
  await captureFailureArtifacts('chat-reopen', { window, consoleLines: active.consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(active.app, dataDir)
}
