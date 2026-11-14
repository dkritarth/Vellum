// Run after build and rebuilding private better-sqlite3 for Electron, under Xvfb.
// VELLUM_183_PDF must name an existing Attention Is All You Need PDF.
// Optional VELLUM_183_RENDERER_URL exercises the npm run dev renderer.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const root = process.cwd(), require = createRequire(root + '/package.json')
const { _electron } = require('playwright')
const { extractText } = await import(root + '/node_modules/unpdf/dist/index.mjs')
const dir = fs.mkdtempSync('/tmp/vellum183-live-')
const slug = 'attention', title = 'Attention Is All You Need'
const folder = dir + '/papers/' + slug
fs.mkdirSync(folder, { recursive: true })
const pdf = fs.readFileSync(process.env.VELLUM_183_PDF)
fs.writeFileSync(folder + '/paper.pdf', pdf)
fs.writeFileSync(folder + '/paper.md', (await extractText(new Uint8Array(pdf), { mergePages: true })).text)
let compiled = fs.readFileSync(root + '/out/main/index.cjs', 'utf8')
function replace(before, after) {
  assert(compiled.includes(before), 'Missing instrumentation anchor: ' + before)
  compiled = compiled.replace(before, after)
}
replace('let chatManager;', `
globalThis.ask183 = { starts: [], release: null, fail: false };
StdioAcpClient.prototype.newSession = async function () {
  return { async *prompt() {
    await new Promise(resolve => { globalThis.ask183.release = resolve; });
    globalThis.ask183.release = null;
    if (globalThis.ask183.fail) {
      globalThis.ask183.fail = false;
      yield {kind: 'error', data: {message: 'Deterministic transport failure'}};
    } else {
      yield {kind: 'text', data: {type: 'text', text: 'Deterministic multiline reply'}};
      yield {kind: 'done', data: {stopReason: 'end_turn'}};
    }
  }, async dispose() {} };
};
let chatManager;`)
replace('  const parsed = parseAskStartParams(params);', '  const parsed = parseAskStartParams(params);\n  globalThis.ask183.starts.push(parsed);')
const paper = {slug, title, authors: ['Ashish Vaswani et al.'], addedAt: new Date().toISOString(), pdfPath: folder + '/paper.pdf', mdPath: folder + '/paper.md'}
replace('  createWindow();', `if (listPapers(getDb(), {}).length === 0) {
  upsertPaper(getDb(), ${JSON.stringify(paper)});
  createChatSession(getDb(), {paperSlug: '${slug}', backend: 'codex', title: 'Multiline verification'});
}
  createWindow();`)
const appPath = root + '/out/main/issue183-live.cjs'
fs.writeFileSync(appPath, compiled)
let app, page
const consoleLines = [], starts = [], geometry = [], records = []
const input = () => page.getByRole('textbox', {name: 'Ask a question', exact: true})
const send = () => page.getByRole('button', {name: 'Send', exact: true})
async function launch() {
  app = await _electron.launch({args: ['--no-sandbox', '--user-data-dir=' + dir + '/profile', appPath], env: {
    ...process.env, ELECTRON_RUN_AS_NODE: '', VELLUM_DATA_DIR: dir,
    ELECTRON_RENDERER_URL: process.env.VELLUM_183_RENDERER_URL || '',
  }})
  app.process().stderr.on('data', data => fs.appendFileSync(dir + '/main.log', data))
  page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('console', message => consoleLines.push(`[${message.type()}] ${message.text()}`))
  page.on('pageerror', error => consoleLines.push('[pageerror] ' + error))
  await page.getByText('bridge: pong', {exact: true}).waitFor()
}
async function open() {
  await page.getByRole('button', {name: 'Library', exact: true}).click()
  await page.getByText(title, {exact: true}).click()
  await page.waitForFunction(() => document.querySelector('[class*=textLayer]')?.textContent?.includes('Abstract'))
  await input().waitFor()
  assert(await input().isEnabled())
}
async function complete(expected, fail = false) {
  await page.getByRole('button', {name: 'Sending…', exact: true}).waitFor()
  assert(await input().isDisabled())
  assert(await page.getByRole('button', {name: 'New chat', exact: true}).isDisabled())
  const trace = await app.evaluate(() => globalThis.ask183.starts)
  assert.equal(trace.length, starts.length + 1)
  assert.deepEqual(trace.at(-1), {slug, chatSessionId: 1, text: expected})
  starts.push(trace.at(-1))
  await app.evaluate(async (_, fail) => {
    while (!globalThis.ask183.release) await new Promise(resolve => setTimeout(resolve, 10))
    globalThis.ask183.fail = fail
    globalThis.ask183.release()
  }, fail)
  await page.waitForFunction(() => document.querySelector('[aria-label="Ask a question"]')?.disabled === false)
  if (fail) await page.getByRole('alert').filter({hasText: 'Deterministic transport failure'}).waitFor()
  assert(await send().isDisabled())
}
async function measure(width) {
  await app.evaluate(({BrowserWindow}, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
  const boxes = await input().evaluate(e => {
    const box = x => {const r=x.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
    return {input:box(e), send:box(e.form.querySelector('button')), row:box(e.form), viewport:{width:innerWidth,height:innerHeight}, overflow:document.documentElement.scrollWidth > innerWidth, tag:e.tagName, label:e.getAttribute('aria-label')}
  })
  assert.equal(boxes.tag, 'TEXTAREA')
  assert.equal(boxes.label, 'Ask a question')
  assert(boxes.input.width > 100 && boxes.input.height > 50)
  assert(boxes.send.right <= boxes.viewport.width && boxes.input.bottom <= boxes.viewport.height)
  assert.equal(boxes.overflow, false)
  geometry.push({width, ...boxes})
}
async function nativeSelection() {
  // Inspect PDF.js text geometry; mouse drag creates native selection, no DOM Range injection.
  const spans = page.locator('[class*=textLayer] span')
  const contents = await spans.allTextContents()
  fs.writeFileSync(dir + '/pdf-spans.json', JSON.stringify(contents, null, 2))
  const index = contents.findIndex(s => s.startsWith('The dominant sequence'))
  assert(index >= 0, 'Abstract line not found')
  const first = spans.nth(index), next = spans.nth(index + 2)
  await first.scrollIntoViewIfNeeded()
  const a = await first.boundingBox(), b = await next.boundingBox()
  assert(a && b)
  await page.mouse.move(a.x + 1, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, {steps: 20})
  await page.mouse.up()
  const quote = await page.evaluate(() => window.getSelection()?.toString().trim())
  assert(quote && quote.includes('\n'), 'Native selection must contain a line break')
  await page.getByRole('toolbar', {name: 'Selection actions'}).waitFor()
  await page.screenshot({path: dir + '/native-selection.png'})
  await page.getByRole('button', {name: 'Add to chat', exact: true}).click()
  assert(await input().evaluate(e => e === document.activeElement))
  return quote
}
try {
  await launch()
  await page.getByText('No paper open', {exact: true}).waitFor()
  await open()
  assert(await page.getByText('Ask a question about this paper.', {exact: true}).isVisible())
  assert(await send().isDisabled())
  await input().pressSequentially('Compare this claim')
  const quote = await nativeSelection()
  const injected = 'Compare this claim\n\n> "' + quote + '" (p. 1)\n\n'
  assert.equal(await input().inputValue(), injected)
  await input().press('Control+Home')
  await page.screenshot({path: dir + '/injected.png'})
  // Native edit and Shift+Enter; only outer whitespace may be trimmed.
  await input().press('Control+End')
  await input().pressSequentially('First question')
  await input().press('Shift+Enter')
  await input().press('Shift+Enter')
  await input().pressSequentially('Second question')
  const expected = injected + 'First question\n\nSecond question'
  assert.equal(await input().inputValue(), expected)
  await measure(1440)
  await page.screenshot({path: dir + '/1440-composer.png'})
  await measure(1000)
  await page.screenshot({path: dir + '/1000-composer.png'})
  await input().press('Enter')
  await page.screenshot({path: dir + '/loading.png'})
  await complete(expected)
  records.push('Native real-paper drag/Add to chat focuses multiline draft; native edit/Shift+Enter/Enter preserves exact request once.')
  await input().pressSequentially('  Button paragraph')
  await input().press('Shift+Enter')
  await input().pressSequentially('Button continuation  ')
  await input().press('Tab')
  assert(await send().evaluate(e => e === document.activeElement))
  await page.screenshot({path: dir + '/1000-send-focus.png'})
  await send().click()
  await complete('Button paragraph\nButton continuation')
  await input().fill('Failure paragraph\n\nKeep boundaries')
  await send().click()
  await complete('Failure paragraph\n\nKeep boundaries', true)
  await page.screenshot({path: dir + '/error.png'})
  await input().fill('Recovery\nparagraph')
  await input().press('Enter')
  await complete('Recovery\nparagraph')
  assert.equal(await page.getByRole('alert').count(), 0)
  const snapshot = await page.evaluate(slug => window.vellum.askOpen(slug), slug)
  assert.deepEqual(snapshot.messages.filter(m => m.role === 'user').map(m => m.content), starts.map(s => s.text))
  await app.close(); app = null
  await launch(); await open()
  const restored = await page.evaluate(slug => window.vellum.askOpen(slug), slug)
  assert.deepEqual(restored.messages, snapshot.messages)
  for (const message of starts) assert(await page.getByText(message.text, {exact: true}).count() === 1)
  await page.screenshot({path: dir + '/restart.png'})
  records.push('Send trims outer boundaries, preserves paragraphs. Keyboard focus, busy/empty/error/recovery checked. Restart returns exact persisted user text.')
  const errors = consoleLines.filter(s => /^\[(error|warning|pageerror)\]/.test(s))
  assert.deepEqual(errors, [])
  fs.writeFileSync(dir + '/result.json', JSON.stringify({passed:true, dir, records, quote, starts, restored:restored.messages, geometry, errors, pdfBytes:pdf.length}, null, 2))
  console.log(JSON.stringify({dir, records, errors}, null, 2))
} catch (error) {
  if (page) await page.screenshot({path: dir + '/failure.png'}).catch(() => {})
  console.error(dir, error)
  throw error
} finally {
  fs.writeFileSync(dir + '/renderer.log', consoleLines.join('\n'))
  if (app) await app.close()
  fs.unlinkSync(appPath)
}
