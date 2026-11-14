// From repo root: xvfb-run -a node docs/verification/issue-148/live.mjs [baseline|fixed]
// Real PDFs must exist at the paths below. Only compiled main is instrumented.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
const root = process.cwd()
const baseline = process.argv[2] === 'baseline'
const dir = fs.mkdtempSync('/tmp/vellum148-live-')
const evidence = process.env.LIVE_EVIDENCE_DIR || root + '/docs/verification/issue-148'
fs.mkdirSync(evidence, { recursive: true })
const papers = [
  { slug: 'paper-a', title: 'Attention Is All You Need', file: '/tmp/vellum-121-attention.pdf', needle: 'Attention Is All You Need' },
  { slug: 'paper-b', title: 'Less Than One-Shot Learning', file: '/tmp/vellum-125-real-paper.pdf', needle: 'Learning N Classes' },
]
for (const p of papers) {
  const folder = dir + '/papers/' + p.slug
  fs.mkdirSync(folder, { recursive: true })
  p.pdfPath = folder + '/paper.pdf'
  p.mdPath = folder + '/paper.md'
  fs.copyFileSync(p.file, p.pdfPath)
  fs.writeFileSync(p.mdPath, 'Live Reader verification uses the original PDF. ACP not exercised.')
}
let compiled = fs.readFileSync(root + '/out/main/index.cjs', 'utf8')
const read = 'return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);'
assert(compiled.includes(read))
compiled = compiled.replace(read, `const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
 const mode = globalThis.reader148.holds.get(slug);
 if(mode) return await new Promise(resolve => {
   const requests = globalThis.reader148.pending.get(slug) || [];
   requests.push({resolve, bytes, mode}); globalThis.reader148.pending.set(slug, requests);
 });
 return bytes;`)
compiled = 'globalThis.reader148 = {holds:new Map(),pending:new Map()};\n' + compiled
const seed = papers.map(p => `upsertPaper(getDb(), ${JSON.stringify({ slug: p.slug, title: p.title, authors: [], addedAt: '2026-11-06T00:00:00.000Z', pdfPath: p.pdfPath, mdPath: p.mdPath })});`).join('\n')
assert(compiled.includes('  createWindow();'))
compiled = compiled.replace('  createWindow();', `${seed}\n  createWindow();`)
const appPath = root + '/out/main/live148.cjs'
fs.writeFileSync(appPath, compiled)
let app, w
const consoleLines = []
async function launch() {
  app = await _electron.launch({ args: ['--no-sandbox', '--user-data-dir=' + dir + '/profile', appPath], env: {
    ...process.env, ELECTRON_RUN_AS_NODE: '', VELLUM_DATA_DIR: dir,
    ELECTRON_RENDERER_URL: process.env.LIVE_RENDERER_URL || '',
  } })
  app.process().stderr.on('data', d => fs.appendFileSync(dir + '/main.log', d))
  w = await app.firstWindow()
  w.setDefaultTimeout(20000)
  w.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`))
  w.on('pageerror', e => consoleLines.push('[pageerror] ' + e))
  await w.getByText('bridge: pong', { exact: true }).waitFor()
}
const tab = index => w.getByRole('tab', { name: papers[index].title, exact: true })
const text = () => w.locator('[class*="textLayer"]')
async function valid(index) {
  await w.waitForFunction(needle => {
    const l = document.querySelector('[class*="textLayer"]')
    return l?.textContent.includes(needle) && l.getBoundingClientRect().width > 0 && !l.parentElement.hidden
  }, papers[index].needle)
}
async function screenshot(name) { await w.screenshot({ path: evidence + '/' + name + '.png' }) }
async function hold(index, mode = 'read') {
  await app.evaluate((_, { slug, mode }) => globalThis.reader148.holds.set(slug, mode), { slug: papers[index].slug, mode })
}
async function pending(index) {
  await w.waitForFunction(() => document.body.textContent.includes('Loading…'))
  // Main IPC has read the real file and now holds its response.
  assert(await app.evaluate((_, slug) => globalThis.reader148.pending.has(slug), papers[index].slug))
}
async function release(index) {
  await app.evaluate((_, slug) => {
    const p = globalThis.reader148.pending.get(slug)
    assertPending(p)
    globalThis.reader148.pending.delete(slug)
    globalThis.reader148.holds.delete(slug)
    for (const request of p) request.resolve(request.mode === 'missing' ? null : request.bytes)
    function assertPending(value) { if (!value) throw Error('No pending read') }
  }, papers[index].slug)
}
async function blank() {
  assert(await w.locator('[class*="pageLayer"]').isHidden())
  assert.equal(await text().textContent(), '')
  assert.equal(await w.getByRole('toolbar', { name: 'Selection actions' }).count(), 0)
  assert.equal(await w.locator('[class*="highlightRect"]').count(), 0)
  assert.equal(await w.evaluate(() => window.getSelection()?.toString()), '')
  assert(await w.getByText('Loading…', { exact: true }).isVisible())
}
async function select(index) {
  const span = text().locator(':scope > span').filter({ hasText: papers[index].needle }).first()
  await span.scrollIntoViewIfNeeded()
  await span.dblclick()
  await w.getByRole('toolbar', { name: 'Selection actions' }).waitFor()
  return w.evaluate(() => window.getSelection()?.toString().trim())
}
try {
  await launch()
  await screenshot(baseline ? 'baseline-empty' : 'empty')
  await w.getByRole('button', { name: 'Library', exact: true }).click()
  await w.getByRole('button', { name: papers[1].title, exact: true }).click()
  await valid(1)
  await w.getByRole('button', { name: 'Library', exact: true }).click()
  await w.getByRole('button', { name: papers[0].title, exact: true }).click()
  await valid(0)
  await w.locator('[class*="zoom"]').getByRole('button', { name: '+', exact: true }).click()
  await w.waitForFunction(() => document.querySelector('[class*=textLayer]')?.style.getPropertyValue('--total-scale-factor') === '1.25')
  await valid(0)
  assert.equal(await w.getByLabel('Zoom', { exact: true }).innerText(), '125%')
  const quoteA = await select(0)
  assert(quoteA && papers[0].needle.includes(quoteA))
  await screenshot(baseline ? 'baseline-a-selection' : 'a-selection')
  await hold(1)
  await tab(1).click()
  await pending(1)
  await screenshot(baseline ? 'before-loading-leak' : 'after-loading')
  if (baseline) {
    assert(await w.locator('[class*="pageLayer"]').isVisible())
    assert((await text().textContent()).includes(papers[0].needle))
    console.log('BASELINE CONFIRMED: B tab active, A canvas/text visible during delayed B read', dir)
  } else {
    await blank()
    await release(1)
    await valid(1)
    assert.equal(await w.getByLabel('Zoom', { exact: true }).innerText(), '125%')
    await screenshot('b-current')
    const quoteB = await select(1)
    assert(quoteB && (await text().textContent()).includes(quoteB))
    await w.getByRole('button', { name: 'Add to chat', exact: true }).click()
    const ask = w.getByRole('textbox', { name: 'Ask a question', exact: true })
    assert((await ask.inputValue()).includes(quoteB))
    assert(!(await ask.inputValue()).includes(quoteA))
    assert(await ask.evaluate(e => e === document.activeElement))
    await screenshot('b-selection-context')
    await ask.fill('Local B draft, no signed-in ACP request')
    await ask.press('Tab')
    assert(await w.getByRole('button', { name: 'Send', exact: true }).evaluate(e => e === document.activeElement))
    // Hold A, return to B before A finishes, then release A last.
    await hold(0)
    await tab(0).click(); await pending(0); await blank()
    await tab(1).click(); await valid(1)
    await release(0); await valid(1)
    assert(!(await text().textContent()).includes(papers[0].needle))
    await screenshot('stale-a-completion')
    // Repeated visible tab controls; final paper must own canvas/text.
    for (let i = 0; i < 4; i++) { await tab(0).click(); await tab(1).click() }
    await valid(1)
    await w.locator('[class*="pageNav"]').getByRole('button', { name: '›', exact: true }).click()
    await w.getByLabel('Page', { exact: true }).filter({ hasText: '2 of' }).waitFor()
    await w.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
    await w.locator('[class*="pageNav"]').getByRole('button', { name: '‹', exact: true }).click(); await valid(1)
    await select(1)
    await w.getByRole('button', { name: 'Highlight yellow', exact: true }).click()
    await w.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length > 0)
    await screenshot('b-highlight')
    await hold(0, 'missing'); await tab(0).click(); await pending(0); await blank(); await release(0)
    await w.getByText('No PDF found for this paper.', { exact: true }).waitFor()
    await screenshot('missing-pdf')
    await tab(1).click(); await valid(1)
    await w.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length > 0)
    await app.close(); app = undefined
    await launch()
    await w.getByRole('button', { name: 'Library', exact: true }).click()
    await w.getByRole('button', { name: papers[1].title, exact: true }).click(); await valid(1)
    await w.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length > 0)
    await screenshot('restart')
    console.log('PASS: delayed reads, selection context/focus, rapid switches, stale completion, zoom/page, highlights, missing PDF, restart', dir)
  }
  const errors = consoleLines.filter(s => /^\[(error|warning|pageerror)\]/.test(s))
  fs.writeFileSync(evidence + '/' + (baseline ? 'baseline' : 'live') + '-console.txt', consoleLines.join('\n') + '\n')
  assert.deepEqual(errors, [])
} catch (error) {
  if (w) await screenshot('failure').catch(() => {})
  fs.writeFileSync(dir + '/console.txt', consoleLines.join('\n'))
  console.error(dir)
  throw error
} finally {
  if (app) await app.close()
  fs.unlinkSync(appPath)
}
