// Verification only. Electron 32 private handler map retains production IPC.
// Run after build + native backup + electron-builder install-app-deps:
// xvfb-run -a node docs/verification/issue-163/live.mjs attention.pdf bert.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchIsolatedApp, assertNoConsoleErrors, captureFailureArtifacts } from '../../../test/harness.mjs'

const papers = process.argv.slice(2).map((p) => path.resolve(p))
assert.equal(papers.length, 2)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-163-'))
const evidence = path.dirname(new URL(import.meta.url).pathname)
const bin = path.join(root, 'bin')
fs.mkdirSync(bin)
for (const adapter of ['codex-acp', 'claude-code-acp']) {
  fs.writeFileSync(path.join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
}
process.env.PATH = `${bin}:${process.env.PATH}`
process.env.XDG_CONFIG_HOME = path.join(root, 'config')
process.env.XDG_CACHE_HOME = path.join(root, 'cache')
const launches = []
const results = []
let app, window
async function launch() {
  const instance = await launchIsolatedApp({ dataDir: path.join(root, 'data') })
  launches.push(instance)
  ;({ app, window } = instance)
  await window.waitForSelector('footer:has-text("bridge: pong")')
}
const editor = () => window.getByRole('textbox', { name: 'Note', exact: true })
const clear = () => window.getByRole('button', { name: 'Clear note', exact: true })
const tab = (name) => window.getByRole('tab', { name, exact: true }).click()
async function noteIs(body) {
  await window.waitForFunction((expected) => {
    const el = document.querySelector('textarea[aria-label="Note"]')
    return el && !el.disabled && el.value === expected
  }, body)
}
async function rendered() {
  await window.waitForFunction(() => document.querySelector('canvas')?.width > 0 && document.querySelectorAll('[class*="textLayer"] span').length > 0)
}
const saved = () => window.getByText('Saved', { exact: true }).waitFor()
const select = (paper) => window.getByRole('tablist', { name: 'Open papers' }).getByRole('tab', { name: paper.title, exact: true }).click()
const read = (slug) => window.evaluate((s) => window.vellum.notesGet(s), slug)
async function arm(slug, outcome) {
  await app.evaluate((_, hold) => { globalThis.__notes163.hold = hold }, { slug, outcome })
}
async function pending() {
  await window.waitForFunction(async () => window.vellum.ping().then(() => true))
  assert(await app.evaluate(() => Boolean(globalThis.__notes163.pending)), 'Read is held')
}
async function release() {
  await app.evaluate(() => {
    const state = globalThis.__notes163
    state.pending()
    state.pending = null
  })
  await window.evaluate(async () => {
    await window.vellum.ping()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}
async function mutations() {
  return app.evaluate(() => globalThis.__notes163.calls.filter((c) => c.channel !== 'vellum:notes-get'))
}
async function blocked() {
  assert(await editor().isDisabled())
  assert(await clear().isDisabled())
  // Actual keyboard input goes to the focused Notes tab, never disabled textarea.
  await window.keyboard.type('must not overwrite unread research')
  assert.equal(await editor().inputValue(), '')
}
async function record(message) { results.push(message); console.log(`PASS ${message}`) }
try {
  await launch()
  await tab('Notes')
  await window.getByText('Open a paper to add notes.', { exact: true }).waitFor()
  for (const paper of papers) {
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await window.getByRole('textbox', { name: 'Paper identifier or URL' }).fill(paper)
    await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
    await window.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 })
    await rendered()
    await noteIs('')
  }
  const library = await window.evaluate(() => window.vellum.listPapers())
  const [a, b] = papers.map((p) => library.find((entry) => entry.title === p))
  assert(a && b && a.slug !== b.slug)
  await editor().fill('B unrelated saved research')
  await saved()
  await select(a)
  await noteIs('')
  await editor().fill('A original saved research with important evidence')
  await saved()
  // Seed unrelated history without any adapter call. Native DB opened only in
  // isolated Electron process, using its ABI. Renderer still uses typed bridge.
  await app.evaluate(async (_, { root, slug, modulePath }) => {
    const Database = process.getBuiltinModule('module').createRequire(`${modulePath}/package.json`)(modulePath)
    const db = new Database(`${root}/data/app.db`)
    const session = db.prepare("INSERT INTO chat_sessions(paper_slug, backend, title, created_at) VALUES (?, 'codex', 'Unrelated retained history', '2026-11-06')").run(slug)
    db.prepare("INSERT INTO chat_messages(session_id, role, content, created_at) VALUES (?, 'user', 'Retain this unrelated research history', '2026-11-06')").run(session.lastInsertRowid)
    db.close()
  }, { root, slug: b.slug, modulePath: path.resolve('node_modules/better-sqlite3') })
  const historyBefore = await window.evaluate(() => window.vellum.chatListSessions())
  const fileHashes = papers.map((p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'))
  await record('Visible Notes placeholder, real-paper ingestion/rendering, true missing-note editor and normal autosave')

  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.__notes163 = { hold: null, pending: null, calls: [] }
    for (const channel of ['vellum:notes-get', 'vellum:notes-save', 'vellum:notes-delete']) {
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error(`Missing production handler ${channel}`)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (event, params) => {
        state.calls.push({ channel, params })
        const hold = state.hold
        if (channel !== 'vellum:notes-get' || !hold || hold.slug !== params) return original(event, params)
        state.hold = null
        const value = hold.outcome === 'resolve' ? original(event, params) : undefined
        return new Promise((resolve, reject) => {
          state.pending = () => hold.outcome === 'resolve' ? resolve(value) : reject(new Error('issue-163 injected read failure'))
        })
      })
    }
  })
  // Remount Notes through visible Details control, hold initial read.
  await tab('Details')
  await arm(a.slug, 'reject')
  await tab('Notes')
  await pending()
  await window.getByRole('status').filter({ hasText: 'Loading note…' }).waitFor()
  await blocked()
  await window.screenshot({ path: path.join(evidence, 'loading.png') })
  await release()
  await window.getByRole('alert').waitFor()
  await blocked()
  await window.screenshot({ path: path.join(evidence, 'load-error.png') })
  assert.deepEqual(await mutations(), [])
  assert.equal((await read(a.slug)).body, 'A original saved research with important evidence')
  // Retry via keyboard. Repeat failure, then successful recovery.
  await arm(a.slug, 'reject')
  const retry = window.getByRole('button', { name: 'Retry', exact: true })
  for (let step = 0; step < 12 && !await retry.evaluate((el) => el === document.activeElement); step++) {
    await window.keyboard.press('Tab')
  }
  assert(await retry.evaluate((el) => el === document.activeElement), 'Retry reachable through keyboard Tab')
  await window.keyboard.press('Enter')
  await pending()
  await blocked()
  await release()
  await window.getByRole('alert').waitFor()
  await arm(a.slug, 'resolve')
  await window.getByRole('button', { name: 'Retry', exact: true }).click()
  await pending()
  await blocked()
  await release()
  await noteIs('A original saved research with important evidence')
  assert.deepEqual(await mutations(), [])
  await window.screenshot({ path: path.join(evidence, 'recovered-original.png') })
  await record('Delayed failure blocks keyboard edits/Clear; accessible repeated error; keyboard Retry recovers original without mutation')

  // Leave during retry, deliver stale result after B loads. Repeat on unmount.
  for (const [exit, outcome] of [['switch', 'resolve'], ['unmount', 'reject']]) {
    await tab('Details')
    await arm(a.slug, 'reject')
    await tab('Notes')
    await pending(); await release()
    await window.getByRole('alert').waitFor()
    await arm(a.slug, outcome)
    await window.getByRole('button', { name: 'Retry', exact: true }).click()
    await pending()
    if (exit === 'switch') {
      await select(b)
      await noteIs('B unrelated saved research')
    } else {
      await tab('Details')
    }
    await release()
    if (exit === 'switch') {
      await noteIs('B unrelated saved research')
      await select(a)
    } else {
      await tab('Notes')
    }
    await noteIs('A original saved research with important evidence')
    assert.deepEqual(await mutations(), [])
  }
  await record('Switch and unmount during retry retire stale success/error, preserve A/B, and issue no save/delete')
  assert.deepEqual(await window.evaluate(() => window.vellum.chatListSessions()), historyBefore)
  assert.equal((await read(b.slug)).body, 'B unrelated saved research')
  await app.close(); app = null
  await launch()
  await tab('Notes')
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: a.title, exact: true }).click()
  await rendered()
  await noteIs('A original saved research with important evidence')
  assert.equal((await read(b.slug)).body, 'B unrelated saved research')
  assert.deepEqual(await window.evaluate(() => window.vellum.chatListSessions()), historyBefore)
  await window.screenshot({ path: path.join(evidence, 'restart-original.png') })
  await record('Complete process restart preserves original A, unrelated B note and history before explicit edit')

  // Loaded edits save normally; quick tab unmount flushes before debounce.
  await editor().click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('\nIntentional loaded edit')
  await saved()
  assert(await editor().evaluate((el) => el === document.activeElement))
  await editor().fill('A outgoing loaded edit')
  await tab('Details')
  assert.equal((await read(a.slug)).body, 'A outgoing loaded edit')
  await tab('Notes')
  await noteIs('A outgoing loaded edit')
  await clear().click()
  await noteIs('')
  assert.equal(await read(a.slug), null)
  await tab('Details'); await tab('Notes')
  await noteIs('')
  await window.screenshot({ path: path.join(evidence, 'missing-note.png') })
  await editor().fill('A final intentional saved note')
  await saved()
  await record('Loaded keyboard editing retains focus and autosaves; outgoing unmount flush and normal Clear/missing-note recovery work')
  await app.close(); app = null
  await launch()
  await tab('Notes')
  for (const [paper, body] of [[a, 'A final intentional saved note'], [b, 'B unrelated saved research']]) {
    await window.getByRole('button', { name: 'Library', exact: true }).click()
    await window.getByRole('button', { name: paper.title, exact: true }).click()
    await noteIs(body)
    await rendered()
  }
  assert.deepEqual(await window.evaluate(() => window.vellum.chatListSessions()), historyBefore)
  await app.evaluate(async (_, { root, modulePath }) => {
    const Database = process.getBuiltinModule('module').createRequire(`${modulePath}/package.json`)(modulePath)
    const db = new Database(`${root}/data/app.db`)
    const rows = db.prepare('SELECT content FROM chat_messages').all()
    if (!rows.some((r) => r.content === 'Retain this unrelated research history')) throw new Error('Unrelated message lost')
    db.close()
  }, { root, modulePath: path.resolve('node_modules/better-sqlite3') })
  const storedFiles = [a, b].map((paper) => crypto.createHash('sha256').update(fs.readFileSync(paper.pdfPath)).digest('hex'))
  assert.deepEqual(storedFiles, fileHashes)
  await record('Second restart retains final edit, unrelated note/history message and byte-identical ingested PDFs')
  const consoleLines = launches.flatMap((instance) => instance.consoleLines)
  assertNoConsoleErrors(consoleLines)
  await record('Zero renderer errors, warnings or page errors across three launches')
  fs.writeFileSync(path.join(evidence, 'live-results.json'), JSON.stringify({ results, consoleLines, paperHashes: fileHashes }, null, 2) + '\n')
} catch (error) {
  await captureFailureArtifacts('notes-load-163', { window, consoleLines: launches.flatMap((instance) => instance.consoleLines) })
  throw error
} finally {
  if (app) await app.close()
  // Keep isolated data for independent parent inspection; no personal state.
  console.log(`Isolated run data: ${root}`)
}
