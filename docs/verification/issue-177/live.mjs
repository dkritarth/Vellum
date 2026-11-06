// Run from repo root after build + isolated native SQLite backup/rebuild.
// xvfb-run -a node docs/verification/issue-177/live.mjs attention.pdf second-paper.pdf /tmp/vellum177-live
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchIsolatedApp } from '../../../test/harness.mjs'

const pdfs = process.argv.slice(2, 4).map((file) => path.resolve(file))
assert.equal(pdfs.length, 2, 'Pass two real local PDF paths')
const evidence = path.resolve(process.argv[4] || '/tmp/vellum177-live')
fs.mkdirSync(evidence, { recursive: true })
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum177-'))
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
async function highlight(color) {
  const quote = await selectNative(color === 'green' ? 1 : 0)
  await window.getByRole('toolbar', { name: 'Selection actions' }).waitFor()
  await screenshot(`selection-${color}`)
  await window.getByRole('button', { name: `Highlight ${color}`, exact: true }).click()
  return quote
}
async function rowCount(count) {
  await window.waitForFunction((n) => document.querySelectorAll('aside[aria-label="Paper panel"] button[aria-label^="Delete highlight:"]').length === n, count)
}
async function selectPaper(paper) {
  await window.getByRole('tablist', { name: 'Open papers' }).getByRole('tab', { name: paper.title, exact: true }).click()
  await window.waitForFunction((needle) => document.querySelector('[class*="textLayer"]')?.textContent?.includes(needle), paper.title === pdfs[0] ? 'Attention' : 'Less Than')
  await rendered()
}
async function arm(mode, slug) {
  await app.evaluate((_, next) => { globalThis.__annotations177.next = next }, { mode, slug })
}
async function release() {
  await app.evaluate(() => { globalThis.__annotations177.release(); globalThis.__annotations177.release = null })
  await window.evaluate(async () => { await window.vellum.ping(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })
}
try {
  await launch()
  await tab('Annotations')
  await panel().getByText('Open a paper to view its highlights.', { exact: true }).waitFor()
  await screenshot('empty')
  for (const pdf of pdfs) {
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await window.getByRole('textbox', { name: 'Paper identifier or URL' }).fill(pdf)
    await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
    await window.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 })
    await rendered()
  }
  const papers = await window.evaluate(() => window.vellum.listPapers())
  const contentHashes = papers.map((paper) => ({
    slug: paper.slug,
    pdf: crypto.createHash('sha256').update(fs.readFileSync(paper.pdfPath)).digest('hex'),
    markdown: crypto.createHash('sha256').update(fs.readFileSync(paper.mdPath)).digest('hex'),
  }))
  const [a, b] = pdfs.map((pdf) => papers.find((paper) => paper.title === pdf))
  assert(a && b && a.slug !== b.slug)
  await tab('Notes')
  await notes().waitFor()
  await notes().fill('B unrelated research preserved by issue 177')
  await window.getByText('Saved', { exact: true }).waitFor()
  await tab('Annotations')
  const bQuote = await highlight('blue')
  await rowCount(1)
  const bBefore = await readHighlights(b.slug)
  assert.equal(bBefore[0].quote, bQuote)
  await selectPaper(a)
  await panel().getByText(/No highlights yet/).waitFor()
  await screenshot('before-create')
  const quote = await highlight('yellow')
  await rowCount(1)
  const row = panel().getByRole('button', { name: `${quote} Page 1`, exact: true })
  assert(await row.isVisible())
  assert.equal(await row.locator('[style]').evaluate((el) => el.style.background), 'yellow')
  assert.equal(await window.getByRole('tab', { name: 'Annotations', exact: true }).getAttribute('aria-selected'), 'true')
  await screenshot('immediate-row')
  record('Native real-paper selection and visible yellow action refresh open list with one correct quote/page/color row')
  await window.getByRole('button', { name: '›', exact: true }).click()
  await window.waitForFunction(() => document.querySelector('[aria-label="Page"]')?.textContent?.startsWith('2 of '))
  await row.click()
  assert(await row.evaluate((el) => el === document.activeElement), 'Jump keeps annotation row focused')
  await window.keyboard.press('Tab')
  assert(await panel().getByRole('button', { name: `Delete highlight: ${quote}`, exact: true }).evaluate((el) => el === document.activeElement), 'Delete reachable by keyboard after row')
  await window.waitForFunction(() => document.querySelector('[aria-label="Page"]')?.textContent?.startsWith('1 of '))
  record('Visible annotation jump keeps row focus and Reader page 1')
  await tab('Notes')
  await notes().fill('A saved note survives annotation refresh and restart')
  await window.getByText('Saved', { exact: true }).waitFor()
  const closedQuote = await highlight('green')
  await tab('Annotations')
  await rowCount(2)
  assert(await panel().getByRole('button', { name: `${closedQuote} Page 1`, exact: true }).count() >= 1)
  await screenshot('closed-tab-reopened')
  record('Creation while Annotations closed loads on reopen; both saved rows remain')

  async function overlayColors(expected) {
    await window.waitForFunction((colors) => {
      const actual = [...document.querySelectorAll('[class*="highlightRect"]')].map(el => el.style.background)
      return colors.every(color => actual.includes(color)) && actual.every(color => colors.includes(color)) && (colors.length > 0 || actual.length === 0)
    }, expected)
  }
  await overlayColors(['yellow', 'green'])
  await screenshot('before-delete')
  const deletes = () => panel().getByRole('button', { name: /^Delete highlight:/ })
  await deletes().nth(0).click()
  await rowCount(1)
  await overlayColors(['green'])
  const remaining = await readHighlights(a.slug)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].color, 'green')
  await screenshot('after-delete')
  record('Visible Delete removes yellow overlay without navigation; green overlay and row remain')

  // Test-only Electron 32 IPC wrapper. Ordinary calls use original production handler.
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.__annotations177 = { next: null, release: null, calls: [] }
    const channel = 'vellum:highlights-delete'
    const original = ipcMain._invokeHandlers.get(channel)
    if (!original) throw new Error('Missing production highlights-delete handler')
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, id) => {
      state.calls.push(id)
      const next = state.next
      if (!next) return original(event, id)
      state.next = null
      return new Promise((resolve, reject) => {
        state.release = () => {
          if (next.mode === 'fail') reject(new Error('issue-177 controlled delete failure'))
          else resolve(original(event, id))
        }
      })
    })
  })
  await arm('fail', a.slug)
  await deletes().click()
  assert(await app.evaluate(() => !!globalThis.__annotations177.release))
  await release()
  await rowCount(1)
  await overlayColors(['green'])
  assert.deepEqual(await readHighlights(a.slug), remaining)
  await screenshot('failed-delete')
  record('Controlled failed delete retains exact saved record, row and green overlay')
  // Keyboard reaches labeled Delete. Enter starts delayed deletion.
  await panel().getByRole('button', { name: /Page 1$/ }).focus()
  await window.keyboard.press('Tab')
  assert(await deletes().evaluate(el => el === document.activeElement))
  await arm('hold', a.slug)
  await window.keyboard.press('Enter')
  assert(await app.evaluate(() => !!globalThis.__annotations177.release))
  await selectPaper(b)
  await rowCount(1)
  await overlayColors(['blue'])
  await release()
  await rowCount(1)
  await overlayColors(['blue'])
  assert.deepEqual(await readHighlights(b.slug), bBefore)
  await screenshot('late-delete-current-b')
  await selectPaper(a)
  await rowCount(0)
  await overlayColors([])
  await screenshot('empty-after-delete')
  record('Delayed outgoing A deletion preserves B overlay/list; return to A shows empty storage/list/overlay')
  await highlight('pink')
  await rowCount(1)
  await overlayColors(['pink'])
  record('Subsequent native creation refreshes open list and Reader after multiple deletions')

  // Capture known base overlay geometry without changing it.
  const overlayGeometry = await window.locator('[class*="highlightRect"]').evaluateAll((els) => els.map((el) => ({ css: el.getAttribute('style'), rect: el.getBoundingClientRect().toJSON() })))
  assert(overlayGeometry.some((overlay) => overlay.rect.width > 0 && overlay.rect.height > 0), 'Visible nonzero highlight geometry')
  const beforeRestart = { a: await readHighlights(a.slug) }
  await app.close()
  app = null
  await launch()
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: a.title, exact: true }).click()
  await rendered()
  await tab('Annotations')
  await rowCount(1)
  await overlayColors(['pink'])
  assert.deepEqual(await readHighlights(a.slug), beforeRestart.a)
  assert.deepEqual(await readHighlights(b.slug), bBefore)
  await tab('Notes')
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value === 'A saved note survives annotation refresh and restart')
  await screenshot('restart-note')
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: b.title, exact: true }).click()
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value === 'B unrelated research preserved by issue 177')
  await tab('Annotations')
  await rowCount(1)
  await overlayColors(['blue'])
  await screenshot('restart-unrelated-b')
  record('Process restart retains A/B highlights, both notes and original PDF bytes')
  assert.deepEqual(pdfs.map((pdf) => crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex')), paperHashes)
  assert.deepEqual(papers.map((paper) => ({
    slug: paper.slug,
    pdf: crypto.createHash('sha256').update(fs.readFileSync(paper.pdfPath)).digest('hex'),
    markdown: crypto.createHash('sha256').update(fs.readFileSync(paper.mdPath)).digest('hex'),
  })), contentHashes)
  const consoleLines = launches.flatMap((entry) => entry.consoleLines)
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  const errors = consoleLines.filter((line) => /^\[(error|warning|pageerror)\]/.test(line))
  // Electron's main process emits the deliberately rejected IPC error separately.
  const unexpected = errors.filter((line) => !line.includes('issue-177 controlled delete failure'))
  assert.deepEqual(unexpected, [])
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ root, results, papers, paperHashes, contentHashes, overlayGeometry, errors }, null, 2))
} catch (error) {
  if (window) await screenshot('failure').catch(() => {})
  fs.writeFileSync(path.join(evidence, 'console.log'), launches.flatMap((entry) => entry.consoleLines).join('\n'))
  throw error
} finally {
  for (let i = 0; i < launches.length; i++) fs.writeFileSync(path.join(evidence, `main-${i}.log`), launches[i].mainLines.join(''))
  if (app) await app.close()
  console.log(`Evidence: ${evidence}; isolated data: ${dataDir}`)
}
