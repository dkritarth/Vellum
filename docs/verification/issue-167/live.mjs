// Run from repository root after build and Electron SQLite rebuild:
// xvfb-run -a node docs/verification/issue-167/live.mjs /absolute/real-paper.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { _electron as electron } from 'playwright'
import { extractText } from 'unpdf'

const root = process.cwd()
const evidence = path.join(root, 'docs/verification/issue-167')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum167-'))
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
const appPath = path.join(root, 'out/main/issue167.cjs')
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
async function install() {
  // Test-only private Electron 32 map retains production handler. No renderer API replacement.
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.__collections167 = { plans: [], pending: [], calls: 0, failures: false }
    const original = ipcMain._invokeHandlers.get('vellum:collections-tree')
    if (!original) throw new Error('Missing production tree handler')
    ipcMain.removeHandler('vellum:collections-tree')
    ipcMain.handle('vellum:collections-tree', async (event, ...args) => {
      state.calls++
      const plan = state.plans.shift()
      if (!plan && !state.failures) return original(event, ...args)
      if (!plan) throw new Error('issue167 current failure')
      // Snapshot actual production data at request time, release later.
      const data = await original(event, ...args)
      return new Promise((resolve, reject) => state.pending.push({ label: plan.label, release: () => plan.error ? reject(new Error('issue167 ' + plan.label)) : resolve(data) }))
    })
  })
}
async function arm(label, error = false) { await app.evaluate((_, plan) => globalThis.__collections167.plans.push(plan), { label, error }) }
async function pending(label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await app.evaluate((_, label) => globalThis.__collections167.pending.some(item => item.label === label), label)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Held request did not start: ' + label)
}
async function settled() { await w.evaluate(async () => { await window.vellum.ping(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }) }
async function release(label) { await app.evaluate((_, label) => { const state = globalThis.__collections167; const index = state.pending.findIndex(item => item.label === label); if (index < 0) throw new Error('Missing held reply ' + label); state.pending.splice(index, 1)[0].release() }, label); await settled() }
async function files() { await w.getByRole('tab', { name: 'Files', exact: true }).click() }
async function chats() { await w.getByRole('tab', { name: 'Chats', exact: true }).click() }
const tree = () => w.getByRole('tree', { name: 'Collections' })
async function create(name) {
  await w.getByRole('button', { name: 'New Collection', exact: true }).click()
  const input = w.getByPlaceholder('Collection name...')
  assert(await input.evaluate(element => element === document.activeElement), 'Create input focused')
  await input.fill(name)
  await input.press('Enter')
  await tree().getByText(name, { exact: true }).waitFor()
  await tree().getByRole('treeitem').filter({ hasText: name }).filter({ has: w.locator('[aria-label="Rename ' + name + '"]') }).waitFor()
  await w.waitForFunction(name => [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].some(item => item.textContent.includes(name)), name)
}
async function preserved() {
  const state = await w.evaluate(async () => ({ papers: await window.vellum.listPapers(), note: await window.vellum.notesGet('attention'), history: await window.vellum.chatListSessions() }))
  assert.equal(state.papers.length, 1)
  assert.equal(state.note.body, 'Preserved research note')
  assert.equal(state.history[0].preview, 'Preserved research question')
  assert.deepEqual(hash(), hashes)
}
try {
  await launch(); await install()
  await tree().getByText(/No collections yet/).waitFor()
  await w.screenshot({ path: path.join(evidence, 'empty.png') })
  await w.getByRole('button', { name: 'New Collection' }).click()
  await w.getByPlaceholder('Collection name...').press('Escape')
  assert.equal(await w.getByPlaceholder('Collection name...').count(), 0)
  record('Empty state, create autofocus and Escape cancel')

  await chats()
  await arm('old-loading-success'); await arm('latest-loading-error', true)
  await files(); await pending('old-loading-success'); await pending('latest-loading-error')
  await release('old-loading-success')
  assert(await tree().getByText('Loading collections...').isVisible())
  await w.screenshot({ path: path.join(evidence, 'loading.png') })
  await release('latest-loading-error')
  await tree().getByRole('alert').filter({ hasText: 'latest-loading-error' }).waitFor()
  await tree().getByRole('alert').waitFor({ state: 'hidden' })
  record('Obsolete initial success leaves newer pending poll loading; latest failure displays and next poll recovers')

  for (const error of [false, true]) {
    await chats(); const label = error ? 'old-initial-error' : 'old-initial-success'
    await arm(label, error); await files(); await pending(label)
    const name = error ? 'Newer error research' : 'Newer success research'
    await create(name)
    await release(label)
    assert(await tree().getByText(name, { exact: true }).isVisible())
    assert.equal(await tree().getByRole('alert').count(), 0)
    await w.screenshot({ path: path.join(evidence, label + '.png') })
    record(label + ' preserves visible created selection')
  }

  // Poll begun before rename snapshots old real data. Rename refresh wins.
  await arm('old-poll'); await pending('old-poll')
  await w.getByRole('button', { name: 'Rename Newer success research', exact: true }).click()
  const input = tree().getByRole('textbox')
  assert(await input.evaluate(element => element === document.activeElement))
  await input.fill('Renamed research'); await input.press('Enter')
  await tree().getByText('Renamed research', { exact: true }).waitFor()
  await release('old-poll')
  assert.equal(await tree().getByText('Newer success research', { exact: true }).count(), 0)
  record('Rename through focused input and Enter survives obsolete successful poll')

  // Hold mutation refresh; newer successful poll must win.
  await arm('old-mutation-error', true)
  await w.getByRole('button', { name: 'Rename Renamed research', exact: true }).click()
  await tree().getByRole('textbox').fill('Final research')
  await w.getByRole('button', { name: 'Save', exact: true }).click()
  await pending('old-mutation-error')
  await tree().getByText('Final research', { exact: true }).waitFor()
  await release('old-mutation-error')
  assert.equal(await tree().getByRole('alert').count(), 0)
  record('Newer poll supersedes held mutation-refresh rejection')

  await arm('old-success-before-current-failure'); await pending('old-success-before-current-failure')
  await app.evaluate(() => { globalThis.__collections167.failures = true })
  await tree().getByRole('alert').filter({ hasText: 'issue167 current failure' }).waitFor()
  await release('old-success-before-current-failure')
  assert(await tree().getByRole('alert').filter({ hasText: 'issue167 current failure' }).isVisible())
  await w.screenshot({ path: path.join(evidence, 'current-error.png') })
  await app.evaluate(() => { globalThis.__collections167.failures = false })
  await tree().getByRole('alert').waitFor({ state: 'hidden' })
  record('Current failure persists through stale success; successful poll recovers')

  await arm('unmounted-error', true); await pending('unmounted-error')
  await chats(); await release('unmounted-error'); await files()
  await tree().getByText('Final research', { exact: true }).waitFor()
  assert.equal(await tree().getByRole('alert').count(), 0)
  record('Unmounted poll rejection cannot publish into remounted tree')

  const collection = (await w.evaluate(() => window.vellum.collectionsTree())).find(item => item.name === 'Final research')
  await w.evaluate(id => window.vellum.collectionsAssign({ paperSlug: 'attention', collectionId: id }), collection.id)
  await w.getByRole('button', { name: 'Library', exact: true }).click()
  await tree().getByRole('treeitem').filter({ hasText: 'Final research' }).click()
  await w.getByRole('list', { name: 'Papers' }).getByText('Attention Is All You Need', { exact: true }).waitFor()
  await w.waitForFunction(() => [...document.querySelectorAll('[role="treeitem"]')].some(item => item.textContent.includes('Final research') && item.textContent.includes('1')))
  await w.screenshot({ path: path.join(evidence, 'membership.png') })
  await preserved()
  record('Real-paper membership filters library and existing direct count becomes 1; note/history/file hashes preserved')
  await app.close(); app = null
  await launch()
  await tree().getByText('Final research', { exact: true }).waitFor()
  assert.equal((await w.evaluate(() => window.vellum.collectionsForPaper('attention')))[0].id, collection.id)
  await preserved()
  await w.screenshot({ path: path.join(evidence, 'restart.png') })
  record('Restart preserves collection, membership, real paper, note, history, exact file hashes')

  await install(); await arm('before-delete'); await pending('before-delete')
  w.once('dialog', dialog => dialog.accept())
  await w.getByRole('button', { name: 'Delete Final research', exact: true }).click()
  await tree().getByText('Final research', { exact: true }).waitFor({ state: 'hidden' })
  await release('before-delete')
  assert.equal(await tree().getByText('Final research', { exact: true }).count(), 0)
  await preserved()
  record('Delete confirmation removes collection despite obsolete poll; paper/note/history/files survive')
  await w.screenshot({ path: path.join(evidence, 'delete.png') })
  const bad = consoles.filter(line => /^\[(error|warning|pageerror)\]/.test(line))
  assert.deepEqual(bad, [])
  fs.writeFileSync(path.join(evidence, 'live-results.json'), JSON.stringify({ results, pdfBytes: pdf.length, markdownCharacters: markdown.length, hashes, isolatedData: dir, consoleErrors: bad }, null, 2) + '\n')
} catch (error) {
  if (w) await w.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
  fs.rmSync(appPath, { force: true })
  fs.writeFileSync(path.join(evidence, 'renderer-console.txt'), consoles.join('\n') + '\n')
  fs.writeFileSync(path.join(evidence, 'main-console.txt'), mainLogs.join(''))
  console.log('Isolated state retained:', dir)
}
