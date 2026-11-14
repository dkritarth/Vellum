// Focused #151 geometry gate. Build first; provide a real PDF via READER_TOOLBAR_PDF.
// Run with Electron's better-sqlite3 binding and a display (e.g. xvfb-run -a).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { extractText } from 'unpdf'
import { launchIsolatedApp, assertNoConsoleErrors, ROOT } from './harness.mjs'

const pdf = process.env.READER_TOOLBAR_PDF
assert(pdf, 'Set READER_TOOLBAR_PDF to a real, multi-page paper PDF')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum151-live-'))
const folder = path.join(dir, 'papers', 'toolbar-paper')
fs.mkdirSync(folder, { recursive: true })
const bytes = fs.readFileSync(pdf)
const extracted = await extractText(new Uint8Array(bytes), { mergePages: true })
fs.writeFileSync(path.join(folder, 'paper.pdf'), bytes)
fs.writeFileSync(path.join(folder, 'paper.md'), extracted.text)
const paper = { slug: 'toolbar-paper', title: 'Toolbar verification paper', authors: [],
  addedAt: '2026-11-06T00:00:00Z', pdfPath: path.join(folder, 'paper.pdf'), mdPath: path.join(folder, 'paper.md') }
// Test-only compiled entry: deterministic metadata, ACP session, and lookup failure.
// Production renderer, PDF.js, IPC/preload and SQLite remain real.
const compiledPath = path.join(ROOT, 'out/main', `toolbar-live-${process.pid}.cjs`)
let compiled = fs.readFileSync(path.join(ROOT, 'out/main/index.cjs'), 'utf8')
function replaceOnce(before, after) {
  assert(compiled.includes(before), `Compiled instrumentation anchor missing: ${before}`)
  compiled = compiled.replace(before, after)
}
replaceOnce('let chatManager;', `
StdioAcpClient.prototype.newSession = async function () {
  return { async *prompt() { yield {kind:'done',data:{stopReason:'end_turn'}} }, async dispose() {} };
};
let chatManager;`)
replaceOnce('  createWindow();', `
if (listPapers(getDb(), {}).length === 0) {
  upsertPaper(getDb(), ${JSON.stringify(paper)});
  const other = {...${JSON.stringify(paper)}, slug:'missing-paper', title:'Unavailable paper'};
  upsertPaper(getDb(), other);
  createChatSession(getDb(), {paperSlug:'toolbar-paper', backend:'codex', title:'Toolbar chat'});
  createChatSession(getDb(), {paperSlug:'missing-paper', backend:'codex', title:'Missing chat'});
}
electron.ipcMain.removeHandler('vellum:get-paper');
electron.ipcMain.handle('vellum:get-paper', (_event, slug) => slug === 'missing-paper' ? null : getPaper(getDb(), slug));
  createWindow();`)
fs.writeFileSync(compiledPath, compiled)
let app, window, consoleLines = []
const geometry = []
async function launch() {
  const launched = await launchIsolatedApp({ appPath: compiledPath, dataDir: dir })
  app = launched.app
  window = launched.window
  consoleLines.push(...launched.consoleLines)
  // Keep capturing after launch, including restart.
  window.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`))
  window.on('pageerror', e => consoleLines.push(`[pageerror] ${e}`))
  await window.getByText('bridge: pong', { exact: true }).waitFor()
}
const main = () => window.getByRole('main', { name: 'Paper view' })
const search = () => window.getByRole('searchbox', { name: 'Search in document' })
const chat = title => window.getByRole('option').filter({ hasText: title })
async function open() {
  await window.getByRole('tab', { name: 'Chats', exact: true }).click()
  await chat('Toolbar chat').click()
  await search().waitFor()
  await window.waitForFunction(() => document.querySelector('[class*=textLayer]')?.textContent?.length > 100)
}
async function measure(label) {
  const record = await window.evaluate(() => {
    const pane = document.querySelector('main[aria-label="Paper view"]')
    const toolbar = pane.querySelector('[class*=toolbar_]')
    const box = e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height } }
    const controls = [...toolbar.querySelectorAll('button,input,span')].map(e => ({
      label:e.getAttribute('aria-label') || e.textContent.trim(), ...box(e),
      visible:getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none',
    }))
    return { viewport:{width:innerWidth,height:innerHeight}, main:box(pane), toolbar:box(toolbar),
      reader:box(pane.querySelector('[class*=reader_]')), body:box(pane.querySelector('[class*=body_]')),
      alert:pane.querySelector('[role=alert]') ? box(pane.querySelector('[role=alert]')) : null,
      sidebar:box(document.querySelector('nav[aria-label="Primary"]')),
      ask:box(document.querySelector('aside[aria-label="Paper panel"]')),
      documentOverflow:document.documentElement.scrollWidth > innerWidth,
      mainScrollWidth:pane.scrollWidth, mainClientWidth:pane.clientWidth, controls }
  })
  geometry.push({ label, ...record })
  await window.screenshot({ path:path.join(dir, `${label}.png`) })
  assert.equal(record.documentOverflow, false, label)
  assert(record.sidebar.width > 0 && record.ask.width > 0, `${label}: both sidebars visible`)
  assert.equal(record.main.right, record.ask.x, `${label}: center ends at Ask`)
  assert(record.body.height > 500, `${label}: remaining paper viewport`)
  for (const c of record.controls) {
    assert(c.visible && c.width > 0 && c.height > 0, `${label}: hidden ${c.label}`)
    assert(c.x >= record.main.x && c.right <= record.main.right, `${label}: ${c.label} exceeds center ${record.main.x}..${record.main.right}, control ${c.x}..${c.right}`)
    assert(c.y >= record.toolbar.y && c.bottom <= record.toolbar.bottom, `${label}: toolbar clips ${c.label}`)
  }
  for (let i = 0; i < record.controls.length; i++) {
    for (const other of record.controls.slice(i + 1)) {
      const c = record.controls[i]
      assert(c.right <= other.x || other.right <= c.x || c.bottom <= other.y || other.bottom <= c.y,
        `${label}: ${c.label} overlaps ${other.label}`)
    }
  }
  assert(record.controls.find(c => c.label === 'Search in document').width >= 128, `${label}: readable search input`)
  assert.equal(record.mainScrollWidth, record.mainClientWidth, `${label}: center overflow`)
  if (record.alert) assert.equal(record.reader.y, record.alert.bottom, `${label}: banner remains above reader`)
  return record
}
async function controls(label) {
  const toolbar = main().locator('[class*=toolbar_]')
  const page = window.locator('[aria-label="Page"]')
  // Continuous-scroll Reader (#203): one slot per page, each with its own
  // text layer and canvas; page buttons are labelled "Previous/Next page".
  const layerText = n => window.evaluate(n => document.querySelector(`[data-page-number="${n}"] [data-text-layer]`)?.textContent ?? '', n)
  // An earlier pass may have left the reader on a search match; start at page 1.
  while (!(await page.innerText()).trim().startsWith('1 of')) {
    await toolbar.getByRole('button', { name:'Previous page', exact:true }).click()
  }
  await window.waitForFunction(() => (document.querySelector('[data-page-number="1"] [data-text-layer]')?.textContent ?? '').length > 100)
  const firstPageText = await layerText(1)
  assert(firstPageText.length > 100, `${label}: page 1 text layer rendered`)
  await toolbar.getByRole('button', { name:'Next page', exact:true }).click()
  await window.waitForFunction(() => document.querySelector('[aria-label=Page]').textContent.trim().startsWith('2 of'))
  await window.waitForFunction(first => {
    const text = document.querySelector('[data-page-number="2"] [data-text-layer]')?.textContent
    return text?.length > 100 && text !== first
  }, firstPageText)
  await toolbar.getByRole('button', { name:'Previous page', exact:true }).click()
  await window.waitForFunction(() => document.querySelector('[aria-label=Page]').textContent.trim().startsWith('1 of'))
  assert.equal(await layerText(1), firstPageText)
  assert.match(await page.innerText(), /1 of/)
  const zoom = window.locator('[aria-label="Zoom"]')
  const initial = await zoom.innerText()
  const canvasWidth = await main().locator('[data-page-number="1"] canvas').evaluate(e => e.width)
  await toolbar.getByRole('button', { name:'Zoom in', exact:true }).click()
  assert.notEqual(await zoom.innerText(), initial)
  await window.waitForFunction(width => document.querySelector('main [data-page-number="1"] canvas').width > width, canvasWidth)
  await toolbar.getByRole('button', { name:'Zoom out', exact:true }).click()
  assert.equal(await zoom.innerText(), initial)
  await window.waitForFunction(width => document.querySelector('main [data-page-number="1"] canvas').width === width, canvasWidth)
  await search().fill('learning')
  await search().press('Enter')
  await window.waitForFunction(() => /^[1-9]/.test(document.querySelector('[aria-label="Search matches"]')?.textContent || ''))
  await measure(`${label}-matches`)
  // Enabled controls retain DOM keyboard order, including search match controls.
  const enabled = toolbar.locator('button:enabled,input:enabled')
  await enabled.first().focus()
  for (let i = 0; i < await enabled.count(); i++) {
    assert(await enabled.nth(i).evaluate(e => e === document.activeElement), `${label}: keyboard order ${i}`)
    const focus = await enabled.nth(i).evaluate(e => ({ outline:getComputedStyle(e).outlineStyle, width:getComputedStyle(e).outlineWidth }))
    assert(focus.outline !== 'none' && focus.width !== '0px', `${label}: visible focus ${i}`)
    await window.screenshot({ path:path.join(dir, `${label}-focus-${i}.png`) })
    if (i + 1 < await enabled.count()) await window.keyboard.press('Tab')
  }
  await window.getByRole('button', { name:'Next match', exact:true }).click()
  assert.match(await window.locator('[aria-label="Search matches"]').innerText(), /^2\s*\//)
  await window.getByRole('button', { name:'Previous match', exact:true }).click()
  assert.match(await window.locator('[aria-label="Search matches"]').innerText(), /^1\s*\//)
  await search().fill('zzzz-no-paper-match')
  await search().press('Enter')
  await window.getByLabel('Search matches', { exact:true }).filter({ hasText:'0 / 0' }).waitFor()
  await measure(`${label}-no-matches`)
  await search().fill('')
  await search().press('Enter')
}
try {
  await launch()
  await window.getByText('No paper open', { exact:true }).waitFor()
  await window.screenshot({ path:path.join(dir, 'empty.png') })
  await open()
  // Start with the reported regression so RED pinpoints the actual overlap.
  for (const width of [1000, 1200, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
    const before = await measure(`${width}-no-error`)
    await controls(`${width}-no-error`)
    await chat('Missing chat').click()
    await window.getByRole('alert').waitFor()
    const banner = await measure(`${width}-error`)
    assert.equal(banner.reader.bottom, before.reader.bottom)
    await controls(`${width}-error`)
    await window.getByRole('button', { name:'Dismiss chat navigation error', exact:true }).click()
    assert.equal(await window.getByRole('alert').count(), 0)
    const restored = await measure(`${width}-dismissed`)
    assert.deepEqual(restored.reader, before.reader)
  }
  await app.close(); app = null
  await launch(); await open()
  await measure('restart')
  assertNoConsoleErrors(consoleLines)
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ passed:true, pdf, geometry }, null, 2))
  console.log(`PASS: ${dir}`)
} catch (error) {
  await window?.screenshot({ path:path.join(dir, 'failure.png') }).catch(() => {})
  console.error(`FAIL: ${dir}`)
  throw error
} finally {
  fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify(geometry, null, 2))
  fs.writeFileSync(path.join(dir, 'renderer.log'), consoleLines.join('\n'))
  if (app) await app.close()
  fs.unlinkSync(compiledPath)
}
