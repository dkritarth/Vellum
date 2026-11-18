// Live check for #228: a signed-in Codex answer about a math-heavy paper
// renders typeset LaTeX in the Ask panel, keeps rendering while streaming,
// survives panel resizing, and renders the same after an app restart.
// Usage: xvfb-run -a node test/math-chat-live.mjs [paper identifier, URL or PDF path]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const paper = process.argv[2] ?? 'https://arxiv.org/pdf/1806.07366'
const evidence = path.join(ROOT, 'test-artifacts', 'math-chat')
fs.mkdirSync(evidence, { recursive: true })

const QUESTION = [
  'Using LaTeX math, explain the core equations of this paper.',
  'Use inline $...$ math in sentences and display $$...$$ blocks on their own lines.',
  'Include the residual update, the ODE dz/dt, the adjoint a(t) and its dynamics, and the parameter gradient dL/dtheta.',
  'Put one inline formula inside a bulleted list item next to bold text.',
  'Also write the full parameter-gradient expression once more as a single long inline $...$ formula inside a sentence.',
].join(' ')

let session = await launchIsolatedApp()
let { app, window, consoleLines } = session
const dataDir = session.dataDir
const allConsole = []
const button = (name) => window.getByRole('button', { name, exact: true })
const tab = (name) => window.getByRole('tab', { name, exact: true })
const answers = () => window.locator('[class*=assistantMessage]')

async function mathStats() {
  return window.evaluate(() => {
    const last = [...document.querySelectorAll('[class*=assistantMessage]')].at(-1)
    if (!last) return null
    const clone = last.cloneNode(true)
    clone.querySelectorAll('.katex-mathml').forEach((node) => node.remove())
    return {
      inline: last.querySelectorAll('.katex').length - last.querySelectorAll('.katex-display').length,
      display: last.querySelectorAll('.katex-display').length,
      errors: last.querySelectorAll('[data-math-error]').length,
      pending: last.querySelectorAll('[data-math-pending]').length,
      rawDollar: (clone.textContent.match(/\$/g) ?? []).length,
      rawCommands: (clone.textContent.match(/\\(frac|partial|theta|mathrm|int|dot)\b/g) ?? []).length,
      overflowing: last.scrollWidth > last.clientWidth + 1,
      threadOverflowing: (() => {
        const thread = last.closest('[class*=thread]')
        return thread ? thread.scrollWidth > thread.clientWidth + 1 : null
      })(),
    }
  })
}

try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(paper)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 240_000 })
  await window.waitForFunction(() => document.querySelector('[data-text-layer]')?.textContent.length > 0, null, { timeout: 120_000 })

  await tab('Ask').click()
  await window.getByRole('combobox', { name: 'Model backend' }).selectOption('codex')
  await window.getByRole('textbox', { name: 'Ask a question', exact: true }).fill(QUESTION)
  await button('Send').click()

  // Sample the message while it streams: it must never crash or lose text.
  const samples = []
  const started = Date.now()
  while (Date.now() - started < 300_000) {
    const sending = await window.evaluate(() => [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…'))
    const alert = await window.getByRole('alert').count()
    const stats = await mathStats()
    if (stats) samples.push({ t: Date.now() - started, ...stats, length: await answers().last().evaluate((node) => node.textContent.length) })
    if (alert) throw new Error(`Chat error: ${await window.getByRole('alert').innerText()}`)
    if (!sending && stats && samples.length > 1) break
    if (samples.length === 6) await window.screenshot({ path: path.join(evidence, '1-streaming.png') })
    await window.waitForTimeout(700)
  }
  fs.writeFileSync(path.join(evidence, 'stream-samples.json'), JSON.stringify(samples, null, 2))
  const lengths = samples.map((sample) => sample.length)
  assert(lengths.every((value, i) => i === 0 || value >= lengths[i - 1] * 0.9), 'Answer text should not collapse while streaming')

  const final = await mathStats()
  console.log('final answer math:', final)
  fs.writeFileSync(path.join(evidence, 'answer.txt'), await answers().last().innerText())
  assert(final.display >= 2, 'expected display equations')
  assert(final.inline >= 2, 'expected inline equations')
  assert.equal(final.pending, 0)
  assert.equal(final.rawCommands, 0, 'no raw LaTeX commands visible')
  await answers().last().locator('.katex-display').first().scrollIntoViewIfNeeded()
  await window.screenshot({ path: path.join(evidence, '2-answer.png') })
  await answers().last().screenshot({ path: path.join(evidence, '2-answer-message.png') })

  // Narrow then widen the right panel; equations must stay inside it.
  const handle = window.getByRole('separator').last()
  await handle.focus()
  for (let i = 0; i < 30; i++) await handle.press('ArrowRight')
  await window.waitForTimeout(300)
  await window.screenshot({ path: path.join(evidence, '3-resized-a.png') })
  await answers().last().screenshot({ path: path.join(evidence, '3-resized-a-message.png') })
  const narrowWidth = await answers().last().evaluate((node) => node.getBoundingClientRect().width)
  for (let i = 0; i < 60; i++) await handle.press('ArrowLeft')
  await window.waitForTimeout(300)
  await window.screenshot({ path: path.join(evidence, '4-resized-b.png') })
  await answers().last().screenshot({ path: path.join(evidence, '4-resized-b-message.png') })
  const wideWidth = await answers().last().evaluate((node) => node.getBoundingClientRect().width)
  console.log('answer widths after resize:', { narrowWidth, wideWidth })
  assert.notEqual(Math.round(narrowWidth), Math.round(wideWidth), 'panel resize should change the answer width')
  const resized = await mathStats()
  assert.equal(resized.overflowing, false, 'message must not overflow horizontally')
  assert.equal(resized.threadOverflowing, false, 'chat thread must not scroll horizontally')

  assertNoConsoleErrors(consoleLines)
  allConsole.push(...consoleLines)
  await app.close()

  // Restart with the same data dir and reopen the conversation.
  session = await launchIsolatedApp({ dataDir })
  ;({ app, window, consoleLines } = session)
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await tab('Chats').click()
  await window.getByRole('option').filter({ hasText: 'Codex' }).first().click()
  await tab('Ask').click()
  await answers().last().locator('.katex-display').first().waitFor()
  const restored = await mathStats()
  console.log('restored answer math:', restored)
  assert.equal(restored.display, final.display)
  assert.equal(restored.inline, final.inline)
  assert.equal(restored.errors, final.errors)
  await answers().last().locator('.katex-display').first().scrollIntoViewIfNeeded()
  await window.screenshot({ path: path.join(evidence, '5-after-restart.png') })
  await answers().last().screenshot({ path: path.join(evidence, '5-after-restart-message.png') })

  // Copying typeset math gives LaTeX source, not duplicated MathML text.
  const copied = await window.evaluate(() => {
    const target = document.querySelector('[class*=assistantMessage] .katex-display')
    const range = document.createRange()
    range.selectNode(target.closest('[data-math-display]') ?? target)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    const data = new DataTransfer()
    const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return data.getData('text/plain')
  })
  console.log('copied display math:', JSON.stringify(copied))
  assert.match(copied, /^\$\$[\s\S]*\\[a-z]+[\s\S]*\$\$$/, 'copy yields $$...$$ LaTeX source')
  assertNoConsoleErrors(consoleLines)
  allConsole.push(...consoleLines)
  console.log('PASS: Codex math answer typeset live, while streaming, after resize and after restart; console clean')
} catch (error) {
  await captureFailureArtifacts('math-chat', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), [...allConsole, ...consoleLines].join('\n'))
  await cleanupIsolatedApp(app, dataDir)
}
