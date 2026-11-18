// Opt-in, signed-in live gate for #254: Stop cancels a streaming Codex answer.
// Real Electron app, real paper, real codex-acp. Nothing about ACP is stubbed.
// Build first, then run under a desktop session or xvfb:
//   xvfb-run -a -s "-screen 0 1440x900x24" node test/stop-answer-live.mjs [paper.pdf] [evidence-dir]
//
// Journey: ingest -> Ask (Codex) -> long answer streams -> Stop (keyboard) ->
// turn ends <= 10 s, composer re-enabled, partial answer saved with a
// "(stopped)" marker -> follow-up reuses the session -> restart (same data
// dir) shows identical conversation -> console clean.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT, launchIsolatedApp, cleanupIsolatedApp, captureFailureArtifacts, assertNoConsoleErrors } from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? '/tmp/vellum-papers/1706.03762.pdf')
assert(fs.existsSync(pdf), `Missing PDF: ${pdf}`)
const evidence = path.resolve(process.argv[3] ?? path.join(ROOT, 'docs', 'evidence', `stop-answer-${new Date().toISOString().slice(0, 10)}`))
fs.mkdirSync(evidence, { recursive: true })

const STOP_DEADLINE_MS = 10_000
const MARKER = '(stopped)'
const consoleLogs = []
const timings = {}
let active
let window
let dataDir
let passed = false
let failure

const nav = () => window.getByRole('navigation', { name: 'Primary' })
const button = (name) => window.getByRole('button', { name, exact: true })
const tab = (name) => window.getByRole('tab', { name, exact: true })
const composer = () => window.getByRole('textbox', { name: 'Ask a question', exact: true })
const answers = () => window.locator('[class*=assistantMessage]')

async function launch() {
  active = await launchIsolatedApp({ dataDir })
  dataDir = active.dataDir
  window = active.window
  window.setDefaultTimeout(30_000)
  await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await window.getByText('bridge: pong', { exact: true }).waitFor()
}

async function close() {
  consoleLogs.push(...active.consoleLines)
  await active.app.close()
  active = undefined
}

const shot = (name) => window.screenshot({ path: path.join(evidence, name) })

/** Every message bubble's text, in thread order. */
async function thread() {
  return window.evaluate(() => [...document.querySelectorAll('[class*=userMessage],[class*=assistantMessage]')]
    .map((element) => `${element.className.includes('userMessage') ? 'user' : 'assistant'}: ${element.innerText.trim()}`))
}

async function waitForIdleComposer(timeout) {
  await window.waitForFunction(() => {
    const box = document.querySelector('textarea[aria-label="Ask a question"]')
    return box && !box.disabled
  }, undefined, { timeout })
}

try {
  await launch()

  // 1. Ingest the real paper through the visible Add Paper flow.
  await nav().getByRole('button', { name: 'Create', exact: true }).click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 180_000 })
  await window.waitForFunction(() => document.querySelector('[data-page-number="1"] canvas')?.width > 0)
  console.log('PASS ingest real paper')

  // 2. Ask tab, Codex backend, request a deliberately long answer.
  await tab('Ask').click()
  const backend = window.getByRole('combobox', { name: 'Model backend' })
  await backend.selectOption('codex')
  await waitForIdleComposer(30_000)
  assert.equal(await backend.inputValue(), 'codex')
  await composer().fill('Explain every section of this paper in detail, at least 1500 words. Write the whole answer directly, without tools or asking me for anything.')
  await button('Send').click()

  // 3. Wait for streamed answer text (past the preamble, into the answer), then Stop is on screen with a name.
  await window.waitForFunction(() => {
    const last = [...document.querySelectorAll('[class*=assistantMessage]')].at(-1)
    return last && last.innerText.trim().length > 600
  }, undefined, { timeout: 180_000 })
  const stop = window.getByRole('button', { name: 'Stop', exact: true })
  await stop.waitFor()
  assert(await stop.isEnabled(), 'Stop must be enabled while streaming')
  assert(await composer().isDisabled(), 'composer is locked while streaming')
  const partialAtStop = (await answers().last().innerText()).trim()
  assert(partialAtStop.length > 600)
  await shot('01-streaming-with-stop.png')
  console.log(`PASS streaming answer visible (${partialAtStop.length} chars), Stop visible`)

  // 4. Stop from the keyboard: focus it and press Enter.
  await stop.focus()
  assert(await stop.evaluate((element) => document.activeElement === element), 'Stop must take keyboard focus')
  const stoppedAt = Date.now()
  await window.keyboard.press('Enter')
  await waitForIdleComposer(STOP_DEADLINE_MS)
  timings.stopToComposerMs = Date.now() - stoppedAt
  assert(timings.stopToComposerMs <= STOP_DEADLINE_MS, `turn took ${timings.stopToComposerMs} ms to end`)
  assert.equal(await window.getByRole('button', { name: /^Stop/ }).count(), 0, 'Stop disappears when the turn ends')
  assert.equal(await window.getByRole('alert').count(), 0, 'a stopped turn is not an error')
  assert(await composer().isEnabled())
  console.log(`PASS turn ended ${timings.stopToComposerMs} ms after Stop`)

  // 5. Persistence choice: the partial answer is kept, marked "(stopped)".
  const afterStop = await thread()
  const stoppedAnswer = afterStop.at(-1)
  assert(stoppedAnswer.startsWith('assistant: '), `last bubble is the stopped answer: ${stoppedAnswer.slice(0, 40)}`)
  assert(stoppedAnswer.trimEnd().endsWith(MARKER), 'stopped answer carries the (stopped) marker')
  assert(stoppedAnswer.length > 600)
  assert(afterStop[0].startsWith('user: Explain every section'))
  assert.equal(afterStop.length, 2)
  const words = stoppedAnswer.split(/\s+/).length
  assert(words < 1500, `answer was cut short (${words} words)`)
  await shot('02-stopped-partial-answer.png')
  console.log(`PASS partial answer saved and marked (${words} words)`)

  // 6. The agent session survives: a follow-up in the same chat completes.
  const answersBefore = await answers().count()
  await composer().fill('Reply with exactly the single word OK.')
  await button('Send').click()
  await window.waitForFunction((count) => {
    const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
    const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
    return document.querySelector('[role=alert]') || (messages.length > count && messages.at(-1).innerText.trim().length > 0 && !sending)
  }, answersBefore, { timeout: 180_000 })
  assert.equal(await window.getByRole('alert').count(), 0, 'follow-up after Stop must not error')
  const followUp = (await answers().last().innerText()).trim()
  assert.match(followUp, /OK/)
  await shot('03-follow-up-after-stop.png')
  console.log('PASS follow-up after Stop completed')
  const beforeRestart = await thread()
  assert.equal(beforeRestart.length, 4)
  const title = (await window.locator('[aria-label="Open papers"] [role=tab]').first().innerText()).trim()

  // 7. Restart with the same data dir; the conversation is identical.
  await close()
  await launch()
  await nav().getByRole('button', { name: 'Library', exact: true }).click()
  await button(title).click()
  await tab('Ask').click()
  await answers().first().waitFor({ timeout: 60_000 })
  await waitForIdleComposer(30_000)
  const afterRestart = await thread()
  assert.deepEqual(afterRestart, beforeRestart, 'conversation after restart must match the pre-restart thread')
  assert.equal(await window.getByRole('button', { name: /^Stop/ }).count(), 0)
  await shot('04-after-restart.png')
  console.log(`PASS restart shows identical conversation (${title})`)

  await close()
  assertNoConsoleErrors(consoleLogs)
  console.log('PASS console clean')
  passed = true
} catch (error) {
  failure = error
  console.error(error)
  if (active) await captureFailureArtifacts('stop-answer-live', { window, consoleLines: active.consoleLines })
} finally {
  await cleanupIsolatedApp(active?.app, dataDir)
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLogs.join('\n') + '\n')
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
    passed,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    pdf,
    timings,
    failure: failure ? String(failure) : undefined,
  }, null, 2) + '\n')
  if (!passed) process.exitCode = 1
}
