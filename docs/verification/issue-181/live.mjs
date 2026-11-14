// Run from repo root after build + isolated native SQLite backup/rebuild.
// xvfb-run -a node docs/verification/issue-181/live.mjs attention.pdf second-paper.pdf /tmp/vellum181-live
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchIsolatedApp } from '../../../test/harness.mjs'

const pdfs = process.argv.slice(2, 4).map((file) => path.resolve(file))
assert.equal(pdfs.length, 2, 'Pass two real local PDF paths')
const evidence = path.resolve(process.argv[4] || '/tmp/vellum181-live')
fs.mkdirSync(evidence, { recursive: true })
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum181-'))
const dataDir = path.join(root, 'data')
const bin = path.join(root, 'bin')
fs.mkdirSync(bin)
for (const adapter of ['codex-acp', 'claude-code-acp']) {
  fs.writeFileSync(path.join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
}
process.env.PATH = `${bin}:${process.env.PATH}`
process.env.XDG_CONFIG_HOME = path.join(root, 'config')
process.env.XDG_CACHE_HOME = path.join(root, 'cache')
let app, window
const launches = []
const results = []
const paperHashes = pdfs.map((pdf) => crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex'))
const tab = (name) => window.getByRole('tab', { name, exact: true }).click()
const panel = () => window.getByRole('complementary', { name: 'Paper panel' })
const notes = () => window.getByRole('textbox', { name: 'Note', exact: true })
const readHighlights = (slug) => window.evaluate((s) => window.vellum.highlightsList(s), slug)
const record = (message) => { results.push(message); console.log(`PASS ${message}`) }
async function launch() {
  const instance = await launchIsolatedApp({ dataDir })
  instance.mainLines = []
  instance.app.process().stderr?.on('data', (chunk) => instance.mainLines.push(chunk.toString()))
  launches.push(instance)
  ;({ app, window } = instance)
  await window.waitForSelector('footer:has-text("bridge: pong")')
  window.setDefaultTimeout(10000)
}
async function rendered() {
  await window.waitForFunction(() => document.querySelector('canvas')?.width > 0 && document.querySelectorAll('[class*="textLayer"] span').length > 0)
}
async function screenshot(name) {
  await window.screenshot({ path: path.join(evidence, `${name}.png`) })
}
async function selectNative(index = 0) {
  // Read geometry only. Chromium receives actual mouse drag; no synthetic
  // Selection, Range injection, React callbacks, or renderer bridge replacement.
  const box = await window.evaluate((index) => {
    const spans = [...document.querySelectorAll('[class*="textLayer"] span')]
    const span = spans.filter((el) => {
      const r = el.getBoundingClientRect()
      return el.firstChild?.nodeType === Node.TEXT_NODE && el.textContent.length > 16 && r.x > 230 && r.right < innerWidth - 320 && r.y > 280 && r.bottom < innerHeight - 50
    })[index]
    if (!span) throw new Error('No visible text span for native selection')
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, Math.min(span.firstChild.length, 18))
    const r = range.getBoundingClientRect()
    return { x: r.left + 1, y: r.top + r.height / 2, end: r.right - 1 }
  }, index)
  await window.mouse.move(box.x, box.y)
  await window.mouse.down()
  await window.mouse.move(box.end, box.y, { steps: 15 })
  await window.mouse.up()
  const quote = await window.evaluate(() => window.getSelection()?.toString().trim())
  assert(quote?.length > 0, 'Native drag selected nonempty text')
  return quote
}
const retry = () => window.getByRole('button', { name: 'Retry saving highlight', exact: true })
const alert = () => window.getByRole('alert').filter({ hasText: 'Highlight was not saved' })
const rowCount = async (n) => window.waitForFunction((n) => document.querySelectorAll('aside[aria-label="Paper panel"] button[aria-label^="Delete highlight:"]').length === n, n)
const overlayColors = async (colors) => window.waitForFunction((colors) => {
  const actual = [...document.querySelectorAll('[class*="highlightRect"]')].map(el => el.style.background)
  return colors.every(c => actual.includes(c)) && actual.every(c => colors.includes(c)) && (colors.length || actual.length === 0)
}, colors)
async function selectPaper(paper) {
  await window.getByRole('tablist', { name: 'Open papers' }).getByRole('tab', { name: paper.title, exact: true }).click()
  await window.waitForFunction((needle) => document.querySelector('[class*="textLayer"]')?.textContent?.includes(needle), paper.title === pdfs[0] ? 'Attention' : 'Less Than')
  await rendered()
}
async function installFaults() {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.__highlight181 = { next: null, calls: [], release: null }
    const channel = 'vellum:highlights-create'
    const original = ipcMain._invokeHandlers.get(channel)
    if (!original) throw Error('Missing create handler')
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, input) => {
      state.calls.push(input)
      const mode = state.next
      state.next = null
      if (!mode) return original(event, input)
      if (mode === 'fail') throw Error('issue-181 controlled create failure')
      return new Promise((resolve, reject) => {
        state.release = () => mode === 'hold-fail'
          ? reject(Error('issue-181 controlled delayed create failure'))
          : resolve(original(event, input))
      })
    })
  })
}
const inject = (mode) => app.evaluate((_, mode) => { globalThis.__highlight181.next = mode }, mode)
const calls = () => app.evaluate(() => globalThis.__highlight181.calls)
async function release() {
  await app.evaluate(() => { globalThis.__highlight181.release(); globalThis.__highlight181.release = null })
  await settle()
}
async function settle() {
  await window.evaluate(async () => { await window.vellum.ping(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))) })
}
async function menuSave(color, index = 0) {
  const quote = await selectNative(index)
  await window.getByRole('button', { name: 'Highlight ' + color, exact: true }).click()
  return quote
}
async function keyboardRetry() {
  await window.getByRole('searchbox', { name: 'Search in document' }).focus()
  await window.keyboard.press('Tab') // Search button
  await window.keyboard.press('Tab') // Retry follows Reader toolbar
  assert(await retry().evaluate(el => document.activeElement === el), 'Tab reaches named Retry')
  await window.keyboard.press('Enter')
}
try {
  await launch()
  await tab('Annotations')
  await panel().getByText('Open a paper to view its highlights.', { exact: true }).waitFor()
  for (const pdf of pdfs) {
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await window.getByRole('textbox', { name: 'Paper identifier or URL' }).fill(pdf)
    await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
    await window.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 })
    await rendered()
  }
  const papers = await window.evaluate(() => window.vellum.listPapers())
  const [a, b] = pdfs.map(pdf => papers.find(p => p.title === pdf))
  assert(a && b && a.slug !== b.slug)
  const contentHashes = papers.map(p => ({ slug: p.slug,
    pdf: crypto.createHash('sha256').update(fs.readFileSync(p.pdfPath)).digest('hex'),
    markdown: crypto.createHash('sha256').update(fs.readFileSync(p.mdPath)).digest('hex') }))
  await tab('Notes'); await notes().fill('Issue 181 unrelated B note preserved'); await window.getByText('Saved', { exact: true }).waitFor()
  await tab('Annotations')
  await menuSave('blue'); await rowCount(1)
  const bBefore = await readHighlights(b.slug)
  await selectPaper(a)
  await tab('Notes'); await notes().fill('Issue 181 A note preserved'); await window.getByText('Saved', { exact: true }).waitFor()
  await tab('Annotations'); await rowCount(0)
  await installFaults()
  await inject('hold-fail')
  const quote = await menuSave('pink')
  await window.getByRole('status').filter({ hasText: 'Saving highlight' }).waitFor()
  assert(await retry().isDisabled())
  assert.equal((await readHighlights(a.slug)).length, 0)
  await rowCount(0); await overlayColors([])
  const original = (await calls())[0]
  assert.equal(original.quote, quote); assert.equal(original.page, 1); assert.equal(original.color, 'pink'); assert.equal(original.slug, a.slug)
  await release(); await alert().waitFor()
  await screenshot('menu-error')
  await inject('hold-fail'); await keyboardRetry()
  assert(await retry().isDisabled())
  await window.keyboard.press('Enter')
  assert.equal((await calls()).length, 2)
  await release(); await alert().waitFor()
  await inject('hold-success'); await keyboardRetry()
  assert(await retry().isDisabled()); await rowCount(0); await overlayColors([])
  await release(); await rowCount(1); await overlayColors(['pink'])
  assert.equal(await alert().count(), 0)
  assert.deepEqual(await calls(), [original, original, original])
  const first = await readHighlights(a.slug)
  assert.equal(first.length, 1)
  assert.deepEqual({ slug: first[0].paperSlug, page: first[0].page, quote: first[0].quote, color: first[0].color, anchor: first[0].anchor }, original)
  await screenshot('menu-recovered')
  record('Visible pink menu action: delayed/repeated rejection, disabled pending retry, Enter retry saves exact captured values once; no false rows/overlays')

  await window.getByRole('button', { name: 'Highlight', exact: true }).click()
  await window.getByRole('button', { name: 'blue highlight color', exact: true }).click()
  await inject('hold-fail')
  const modeQuote = await selectNative(1)
  await window.getByRole('status').filter({ hasText: 'Saving highlight' }).waitFor()
  await release(); await alert().waitFor(); await rowCount(1); await overlayColors(['pink'])
  await screenshot('mode-error')
  const modeOriginal = (await calls())[3]
  assert.equal(modeOriginal.quote, modeQuote); assert.equal(modeOriginal.color, 'blue')
  await window.getByRole('button', { name: 'green highlight color', exact: true }).click()
  await inject('fail'); await keyboardRetry(); await alert().waitFor()
  await keyboardRetry(); await rowCount(2); await overlayColors(['pink', 'blue'])
  assert.deepEqual((await calls()).slice(3), [modeOriginal, modeOriginal, modeOriginal])
  const saved = await readHighlights(a.slug)
  assert.equal(saved.length, 2)
  assert.equal(saved[1].quote, modeQuote); assert.equal(saved[1].color, 'blue'); assert.equal(saved[1].anchor, modeOriginal.anchor)
  await screenshot('mode-recovered')
  record('Highlight mode: delayed/repeated failure, keyboard retry without reselection preserves original blue despite current green; exactly one additional row')

  await window.getByRole('button', { name: 'Highlight', exact: true }).click()
  await inject('fail'); await menuSave('yellow', 0); await alert().waitFor()
  await selectNative(1)
  assert.equal(await alert().count(), 0); assert.equal(await retry().count(), 0)
  assert(await window.getByRole('toolbar', { name: 'Selection actions' }).isVisible())
  await window.keyboard.press('Escape')
  await inject('hold-fail'); await menuSave('yellow', 0)
  await window.getByRole('button', { name: '›', exact: true }).click()
  await window.waitForFunction(() => document.querySelector('[aria-label="Page"]')?.textContent.startsWith('2 of'))
  await release(); assert.equal(await alert().count(), 0); assert.equal(await retry().count(), 0)
  await window.getByRole('button', { name: '‹', exact: true }).click()
  await window.waitForFunction(() => document.querySelector('[aria-label="Page"]')?.textContent.startsWith('1 of'))
  await rendered()
  await inject('fail'); await menuSave('yellow', 0); await alert().waitFor()
  const firstRow = panel().getByRole('button', { name: first[0].quote + ' Page 1', exact: true })
  await firstRow.click()
  assert(await firstRow.evaluate(el => el === document.activeElement), 'Same-page jump retains row focus')
  assert.equal(await alert().count(), 0); assert.equal(await retry().count(), 0)
  record('New native selection and page navigation retire obsolete retry; delayed page failure stays retired; same-page annotation jump clears error and retains focus')

  await settle()
  await inject('hold-fail'); await menuSave('yellow', 1)
  await selectPaper(b); await rowCount(1); await overlayColors(['blue'])
  await selectPaper(a); await rowCount(2); await overlayColors(['pink', 'blue'])
  await release(); assert.equal(await alert().count(), 0); assert.equal(await retry().count(), 0)
  assert.deepEqual(await readHighlights(a.slug), saved); assert.deepEqual(await readHighlights(b.slug), bBefore)
  record('Outgoing delayed failure after paper switch and revisit cannot contaminate current paper; exact stored records unchanged')

  // Preserve #178/#180 integration through real deletion and list refresh.
  await panel().getByRole('button', { name: 'Delete highlight: ' + saved[0].quote, exact: true }).first().click()
  await rowCount(1); await overlayColors(['blue'])
  assert.deepEqual(await readHighlights(a.slug), saved.slice(1))
  const overlayGeometry = await window.locator('[class*="highlightRect"]').evaluateAll(els => els.map(el => ({ css: el.getAttribute('style'), rect: el.getBoundingClientRect().toJSON() })))
  await app.close(); app = null
  await launch()
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: a.title, exact: true }).click(); await rendered(); await tab('Annotations')
  await rowCount(1); await overlayColors(['blue'])
  assert.deepEqual(await readHighlights(a.slug), saved.slice(1)); assert.deepEqual(await readHighlights(b.slug), bBefore)
  assert.equal(await retry().count(), 0)
  await tab('Notes')
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value === 'Issue 181 A note preserved')
  await screenshot('restart-note')
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: b.title, exact: true }).click(); await rendered()
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value === 'Issue 181 unrelated B note preserved')
  await tab('Annotations'); await rowCount(1); await overlayColors(['blue'])
  await screenshot('restart-b')
  assert.deepEqual(pdfs.map(pdf => crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex')), paperHashes)
  assert.deepEqual(papers.map(p => ({ slug: p.slug,
    pdf: crypto.createHash('sha256').update(fs.readFileSync(p.pdfPath)).digest('hex'),
    markdown: crypto.createHash('sha256').update(fs.readFileSync(p.mdPath)).digest('hex') })), contentHashes)
  record('Successful deletion still removes only target; full process restart retains both papers highlights/notes and exact source/ingested PDF/Markdown hashes')
  const consoleLines = launches.flatMap(entry => entry.consoleLines)
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  const errors = consoleLines.filter(line => /^\[(error|warning|pageerror)\]/.test(line))
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ root, results, papers, paperHashes, contentHashes, original, modeOriginal, saved, overlayGeometry, errors }, null, 2))
} catch (error) {
  if (window) await screenshot('failure').catch(() => {})
  fs.writeFileSync(path.join(evidence, 'console.log'), launches.flatMap(entry => entry.consoleLines).join('\n'))
  throw error
} finally {
  for (let i = 0; i < launches.length; i++) fs.writeFileSync(path.join(evidence, 'main-' + i + '.log'), launches[i].mainLines.join(''))
  if (app) await app.close()
  console.log('Evidence: ' + evidence + '; isolated data: ' + dataDir)
}
