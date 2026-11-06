// Run from repository root after build and Electron SQLite rebuild:
// xvfb-run -a node docs/verification/issue-171/live.mjs /absolute/real-paper.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { _electron as electron } from 'playwright'
import { extractText } from 'unpdf'

const root = process.cwd()
const evidence = path.join(root, 'docs/verification/issue-171')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum171-'))
const pdf = fs.readFileSync(process.argv[2])
const markdown = (await extractText(new Uint8Array(pdf), { mergePages: true })).text
assert(markdown.includes('Attention'), 'Use Attention Is All You Need real PDF')
const paperDir = path.join(dir, 'papers/attention')
fs.mkdirSync(paperDir, { recursive: true })
fs.writeFileSync(path.join(paperDir, 'paper.pdf'), pdf)
fs.writeFileSync(path.join(paperDir, 'paper.md'), markdown)
const hash = () => ['paper.pdf', 'paper.md'].map(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(paperDir, file))).digest('hex'))
const hashes = hash()
const bin = path.join(dir, 'bin')
fs.mkdirSync(bin)
for (const adapter of ['codex-acp', 'claude-code-acp']) fs.writeFileSync(path.join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
const appPath = path.join(root, 'out/main/issue171.cjs')
let compiled = fs.readFileSync(path.join(root, 'out/main/index.cjs'), 'utf8')
const seed = `
  if (!getDb().prepare("SELECT slug FROM papers WHERE slug='attention'").get()) {
    upsertPaper(getDb(), {slug:'attention',title:'Attention Is All You Need',authors:[],addedAt:'2026-11-06',pdfPath:${JSON.stringify(path.join(paperDir, 'paper.pdf'))},mdPath:${JSON.stringify(path.join(paperDir, 'paper.md'))}});
    getDb().prepare("INSERT INTO notes(paper_slug,body,updated_at) VALUES ('attention','Preserved research note','2026-11-06')").run();
    const session = createChatSession(getDb(), {paperSlug:'attention',backend:'codex',title:'Preserved history'});
    addChatMessage(getDb(), {sessionId:session.id,role:'user',content:'Preserved research question'});
  }
`
assert(compiled.includes('  createWindow();'))
compiled = compiled.replace('  createWindow();', seed + '\n  createWindow();')
fs.writeFileSync(appPath, compiled)
let app, w
const consoles = [], mainLogs = [], results = []
const record = text => { results.push(text); console.log('PASS', text) }
async function launch() {
  app = await electron.launch({ args: ['--no-sandbox', '--user-data-dir=' + path.join(dir, 'profile'), appPath], env: { ...process.env, ELECTRON_RUN_AS_NODE: '', VELLUM_DATA_DIR: dir, XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_CACHE_HOME: path.join(dir, 'cache'), PATH: bin + ':' + process.env.PATH } })
  app.process().stdout.on('data', data => mainLogs.push(String(data)))
  app.process().stderr.on('data', data => mainLogs.push(String(data)))
  w = await app.firstWindow()
  w.on('console', message => consoles.push(`[${message.type()}] ${message.text()}`))
  w.on('pageerror', error => consoles.push('[pageerror] ' + error.stack))
  await w.waitForSelector('footer:has-text("bridge: pong")')
}
const tree = () => w.getByRole('tree', { name: 'Collections' })
const row = name => tree().getByRole('treeitem').filter({ has: w.getByText(name, { exact: true }) })
async function selected(name) { await w.waitForFunction(name => [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].some(item => [...item.querySelectorAll('span')].some(span => span.textContent === name)), name) }
async function select(name) { await row(name).click(); await selected(name) }
async function create(name, parent) {
  await w.getByRole('button', { name: parent ? 'Add subcollection to ' + parent : 'New Collection', exact: true }).click()
  const input = w.getByPlaceholder(parent ? 'Subcollection name...' : 'Collection name...')
  assert(await input.evaluate(element => element === document.activeElement), 'Create autofocus')
  await input.fill(name)
  await input.press('Tab')
  assert(await w.getByRole('button', { name: 'Add', exact: true }).evaluate(element => element === document.activeElement), 'Tab reaches Add')
  await w.keyboard.press('Enter')
  await selected(name)
}
async function nested(prefix) {
  await create(prefix + ' parent')
  await create(prefix + ' child', prefix + ' parent')
  await create(prefix + ' deep', prefix + ' child')
  const items = await w.evaluate(() => window.vellum.collectionsTree())
  const parent = items.find(item => item.name === prefix + ' parent')
  const child = parent.children[0], deep = child.children[0]
  for (const id of [child.id, deep.id]) await w.evaluate(id => window.vellum.collectionsAssign({ paperSlug: 'attention', collectionId: id }), id)
  await select("All Papers")
  return { parent, child, deep }
}
async function papers() {
  await w.getByRole('list', { name: 'Papers' }).getByText('Attention Is All You Need', { exact: true }).waitFor()
}
async function allPapers() {
  await selected('All Papers')
  assert.equal(await w.getByText('Filtered by collection:', { exact: false }).count(), 0)
  await papers()
}
async function remove(name, accept = true) {
  w.once('dialog', async dialog => {
    assert.equal(dialog.message(), `Delete collection "${name}" and all subcollections? Papers will not be deleted.`)
    await (accept ? dialog.accept() : dialog.dismiss())
  })
  const button = w.getByRole('button', { name: 'Delete ' + name, exact: true })
  await button.focus()
  await w.keyboard.press('Enter')
}
async function preserved() {
  const state = await w.evaluate(async () => ({ papers: await window.vellum.listPapers(), note: await window.vellum.notesGet('attention'), history: await window.vellum.chatListSessions(), collections: await window.vellum.collectionsTree() }))
  assert.equal(state.papers.length, 1)
  assert.equal(state.note.body, 'Preserved research note')
  assert.equal(state.history[0].preview, 'Preserved research question')
  assert(state.collections.some(item => item.name === 'Unrelated research'))
  assert.deepEqual(hash(), hashes)
}
async function installDeleteControl() {
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('vellum:collections-delete')
    if (!original) throw new Error('Missing production delete handler')
    const state = globalThis.__delete171 = { mode: null, pending: null }
    ipcMain.removeHandler('vellum:collections-delete')
    ipcMain.handle('vellum:collections-delete', async (event, ...args) => {
      const mode = state.mode; state.mode = null
      if (!mode) return original(event, ...args)
      if (mode === 'fail') throw new Error('issue171 controlled disk I/O error')
      // Hold before real deletion, or after it so polling can remove visible rows before acknowledgement.
      const result = mode === 'after' ? await original(event, ...args) : undefined
      return new Promise((resolve, reject) => { state.pending = async () => {
        state.pending = null
        try { resolve(mode === 'after' ? result : await original(event, ...args)) } catch (error) { reject(error) }
      } })
    })
  })
}
async function arm(mode) { await app.evaluate((_, mode) => { globalThis.__delete171.mode = mode }, mode) }
async function pending() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await app.evaluate(() => Boolean(globalThis.__delete171.pending))) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Delete did not become pending')
}
async function release() { await app.evaluate(async () => { await globalThis.__delete171.pending() }) }
try {
  await launch(); await installDeleteControl()
  await tree().getByText(/No collections yet/).waitFor()
  await w.getByRole('button', { name: 'New Collection' }).focus(); await w.keyboard.press('Enter')
  await w.getByPlaceholder('Collection name...').press('Escape')
  assert.equal(await tree().getByRole('textbox').count(), 0)
  await w.screenshot({ path: path.join(evidence, 'empty.png') })
  record('Empty tree, keyboard New Collection, autofocus/Escape cancellation')
  await create('Unrelated research')
  const unrelated = (await w.evaluate(() => window.vellum.collectionsTree()))[0]
  await w.evaluate(id => window.vellum.collectionsAssign({ paperSlug: 'attention', collectionId: id }), unrelated.id)
  await w.getByRole('button', { name: 'Library', exact: true }).click()

  for (const selectedLevel of ['child', 'deep']) {
    await nested(selectedLevel)
    await select(selectedLevel + ' ' + selectedLevel)
    await papers()
    await w.screenshot({ path: path.join(evidence, selectedLevel + '-before.png') })
    await remove(selectedLevel + ' parent', false)
    await selected(selectedLevel + ' ' + selectedLevel)
    assert(await row(selectedLevel + ' parent').isVisible())
    await remove(selectedLevel + ' parent')
    await row(selectedLevel + ' parent').waitFor({ state: 'hidden' })
    await allPapers(); await preserved()
    await w.screenshot({ path: path.join(evidence, selectedLevel + '-after.png') })
    record('Visible nested create, real-paper ' + selectedLevel + ' filter, cancel retains filter, ancestor delete returns all papers')
  }

  await nested('unrelated')
  await select('Unrelated research'); await papers()
  await remove('unrelated parent')
  await row('unrelated parent').waitFor({ state: 'hidden' })
  await selected('Unrelated research'); await papers()
  record('Deleting another subtree preserves unrelated real-paper filter')

  for (const [prefix, start, next, mode, clears] of [
    ['switch-out', 'parent', 'Unrelated research', 'before', false],
    ['switch-in', 'unrelated', 'switch-in deep', 'before', true],
    ['switch-all', 'child', 'All Papers', 'before', true],
    ['ack', 'deep', null, 'after', true],
  ]) {
    await nested(prefix)
    await select(start === 'unrelated' ? 'Unrelated research' : prefix + ' ' + start)
    await arm(mode); await remove(prefix + ' parent'); await pending()
    if (mode === 'after') await row(prefix + ' parent').waitFor({ state: 'hidden' })
    else assert(await row(prefix + ' parent').isVisible())
    if (next) await select(next)
    await release()
    await row(prefix + ' parent').waitFor({ state: 'hidden' })
    if (clears) await allPapers()
    else { await selected('Unrelated research'); await papers() }
    await preserved()
    await w.screenshot({ path: path.join(evidence, prefix + '.png') })
    record(prefix + ': latest selection reconciled after controlled ' + mode + '-deletion hold')
  }

  await nested('failure'); await select('failure deep'); await papers()
  await arm('fail'); await remove('failure parent')
  await tree().getByRole('alert').filter({ hasText: 'issue171 controlled disk I/O error' }).waitFor()
  await selected('failure deep'); await papers()
  assert(await row('failure parent').isVisible())
  await w.screenshot({ path: path.join(evidence, 'failure-retained.png') })
  await remove('failure parent')
  await row('failure parent').waitFor({ state: 'hidden' })
  await allPapers()
  assert.equal(await tree().getByRole('alert').count(), 0)
  record('Controlled deletion failure preserves subtree/filter/paper and useful feedback; retry clears error/filter')

  await create('Direct research'); await remove('Direct research')
  await row('Direct research').waitFor({ state: 'hidden' }); await allPapers()
  await preserved()
  record('Direct selected deletion still clears filter')
  // New control remains keyboard reachable after deletion. No focus restoration claim.
  await w.getByRole('button', { name: 'New Collection' }).focus()
  assert(await w.getByRole('button', { name: 'New Collection' }).evaluate(element => element === document.activeElement))
  await select('Unrelated research'); await papers()
  await app.close(); app = null
  await launch()
  await row('Unrelated research').waitFor()
  await preserved()
  assert((await w.evaluate(() => window.vellum.collectionsForPaper('attention'))).some(item => item.id === unrelated.id))
  await w.getByRole('button', { name: 'Library', exact: true }).click()
  await select('Unrelated research'); await papers()
  await w.screenshot({ path: path.join(evidence, 'restart.png') })
  record('Full restart preserves unrelated collection/membership, real paper, note/history and exact PDF/markdown hashes; filter usable again')
  const bad = consoles.filter(line => /^\[(error|warning|pageerror)\]/.test(line))
  assert.equal(bad.length, 1)
  assert(bad[0].includes('Failed to delete collection') && bad[0].includes('issue171 controlled disk I/O error'))
  fs.writeFileSync(path.join(evidence, 'live-results.json'), JSON.stringify({ results, pdfBytes: pdf.length, markdownCharacters: markdown.length, hashes, isolatedData: dir, consoleErrors: bad, expectedInjectedErrors: 1 }, null, 2) + '\n')
} catch (error) {
  if (w) await w.screenshot({ path: path.join(evidence, 'harness-failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
  fs.rmSync(appPath, { force: true })
  fs.writeFileSync(path.join(evidence, 'renderer-console.txt'), consoles.join('\n') + '\n')
  fs.writeFileSync(path.join(evidence, 'main-console.txt'), mainLogs.join(''))
  console.log('Isolated state retained:', dir)
}
