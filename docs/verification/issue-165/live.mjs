// Verification only. Electron 32 private handler map retains production IPC.
// Run after build + native backup + electron-builder install-app-deps:
// xvfb-run -a node docs/verification/issue-165/live.mjs attention.pdf bert.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchIsolatedApp, assertNoConsoleErrors, captureFailureArtifacts } from '../../../test/harness.mjs'

const papers = process.argv.slice(2).map((p) => path.resolve(p))
assert.equal(papers.length, 2)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-165-'))
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
async function arm(slug, outcome, operation = 'save') {
  await app.evaluate((_, hold) => { globalThis.__notes165.hold = hold }, { slug, outcome, operation })
}

async function release() {
  await app.evaluate(() => {
    const state = globalThis.__notes165
    state.pending()
    state.pending = null
  })
  await window.evaluate(async () => {
    await window.vellum.ping()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}
async function mutations() {
  return app.evaluate(() => globalThis.__notes165.calls.filter((c) => c.channel !== 'vellum:notes-get'))
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

  async function installFaults() {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis.__notes165 = { hold: null, pending: null, calls: [] }
      for (const channel of ['vellum:notes-get', 'vellum:notes-save', 'vellum:notes-delete']) {
        const original = ipcMain._invokeHandlers.get(channel)
        if (!original) throw new Error(`Missing production handler ${channel}`)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (event, params) => {
          state.calls.push({ channel, params })
          const hold = state.hold
          const slug = channel === 'vellum:notes-save' ? params.slug : params
          if (!hold || hold.slug !== slug || channel !== `vellum:notes-${hold.operation}`) return original(event, params)
          state.hold = null
          return new Promise((resolve, reject) => {
            state.pending = () => hold.outcome === 'resolve'
              ? resolve(original(event, params))
              : reject(new Error(`issue-165 injected ${hold.operation} failure`))
          })
        })
      }
    })
  }
  await installFaults()
  async function restartWithNotes(aBody) {
    await app.close(); app = null
    await launch(); await tab('Notes')
    for (const [paper, body] of [[b, 'B unrelated saved research'], [a, aBody]]) {
      await window.getByRole('button', { name: 'Library', exact: true }).click()
      await window.getByRole('button', { name: paper.title, exact: true }).click()
      await noteIs(body); await rendered()
    }
    assert.deepEqual(await window.evaluate(() => window.vellum.chatListSessions()), historyBefore)
    await installFaults()
  }
  async function held() {
    await window.waitForFunction(() => window.vellum.ping())
    // IPC call starts after the editor debounce. Wait on main state with a
    // bounded Playwright assertion, without adding product test hooks.
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate(() => Boolean(globalThis.__notes165.pending))) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Expected held note operation')
  }
  async function error(operation) {
    await window.getByRole('alert').filter({ hasText: `Could not ${operation === 'delete' ? 'clear' : 'save'} this note` }).waitFor()
    assert.equal(await window.getByText('Saved', { exact: true }).count(), 0)
  }
  async function keyboardRetry(name) {
    const retry = window.getByRole('button', { name, exact: true })
    for (let i = 0; i < 30 && !await retry.evaluate((el) => el === document.activeElement); i++) await window.keyboard.press('Tab')
    assert(await retry.evaluate((el) => el === document.activeElement), 'Retry reached by Tab')
    await window.keyboard.press('Enter')
  }
  await arm(a.slug, 'reject')
  await editor().click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('\nNew unsaved evidence')
  const unsaved = await editor().inputValue()
  await held()
  await window.getByText('Saving…', { exact: true }).waitFor()
  assert.equal((await read(a.slug)).body, 'A original saved research with important evidence')
  await release(); await error('save'); await noteIs(unsaved)
  assert(await editor().evaluate((el) => el === document.activeElement), 'Failure preserves editor focus')
  await window.screenshot({ path: path.join(evidence, 'save-error.png') })
  await arm(a.slug, 'reject')
  await keyboardRetry('Retry save'); await held(); await release(); await error('save')
  await noteIs(unsaved)
  await arm(a.slug, 'resolve')
  await keyboardRetry('Retry save'); await held(); await release(); await saved()
  assert.equal((await read(a.slug)).body, unsaved)
  assert.equal(await window.getByRole('alert').count(), 0)
  await window.screenshot({ path: path.join(evidence, 'save-recovered.png') })
  await restartWithNotes(unsaved)
  await window.screenshot({ path: path.join(evidence, 'save-restart.png') })
  await record('Delayed rejected autosave preserves draft/focus and old storage; keyboard retry repeats failure then saves same draft; process restart retains recovered save')

  // Restore an unsaved draft, not just the older stored note, after Clear fails.
  await arm(a.slug, 'reject', 'delete')
  await editor().fill('Unsaved draft immediately before Clear')
  await clear().click(); await held(); await release(); await error('delete')
  await noteIs('Unsaved draft immediately before Clear')
  await window.screenshot({ path: path.join(evidence, 'clear-error.png') })
  await arm(a.slug, 'reject', 'delete')
  await keyboardRetry('Retry Clear'); await held(); await release(); await error('delete')
  await noteIs('Unsaved draft immediately before Clear')
  // New typing invalidates obsolete Clear retry. Later Retry must save text.
  await arm(a.slug, 'reject')
  await editor().click(); await window.keyboard.press('Control+End')
  await window.keyboard.type(' plus new research')
  const newer = await editor().inputValue()
  assert.equal(await window.getByRole('button', { name: 'Retry Clear', exact: true }).count(), 0)
  await held(); await release(); await error('save')
  const deleteCount = (await mutations()).filter((c) => c.channel === 'vellum:notes-delete').length
  await keyboardRetry('Retry save'); await saved(); await noteIs(newer)
  assert.equal((await read(a.slug)).body, newer)
  assert.equal((await mutations()).filter((c) => c.channel === 'vellum:notes-delete').length, deleteCount)
  await record('Repeated Clear failure restores exact unsaved draft; newer keyboard edit removes obsolete Clear intent and Retry saves latest text')

  await arm(a.slug, 'reject', 'delete')
  await clear().click(); await held(); await release(); await error('delete')
  await arm(a.slug, 'resolve', 'delete')
  await keyboardRetry('Retry Clear'); await held(); await release()
  await window.getByText('Cleared', { exact: true }).waitFor()
  await noteIs(''); assert.equal(await read(a.slug), null)
  assert.equal(await window.getByRole('alert').count(), 0)
  await window.screenshot({ path: path.join(evidence, 'clear-recovered.png') })
  await restartWithNotes('')
  assert.equal(await read(a.slug), null)
  await record('Explicit Clear retry invokes production delete, reports Cleared and removes stored note across process restart')

  await editor().fill('A current saved research'); await saved()
  for (const operation of ['save', 'delete']) {
    await arm(a.slug, 'reject', operation)
    if (operation === 'save') await editor().fill('A held unsaved research')
    else await clear().click()
    await held()
    await select(b); await noteIs('B unrelated saved research')
    await release()
    await noteIs('B unrelated saved research')
    assert.equal(await window.getByRole('alert').count(), 0)
    assert.equal(await window.getByRole('button', { name: /Retry/ }).count(), 0)
    await select(a); await noteIs('A current saved research')
  }
  await record('Late rejected save and Clear after visible paper switch cannot replace B text or show obsolete error; revisit reads persisted A')
  // Existing #164 live read-retry protection remains independently exercised.
  await tab('Details'); await arm(a.slug, 'reject', 'get'); await tab('Notes'); await held()
  assert(await editor().isDisabled()); assert(await clear().isDisabled())
  await release(); await window.getByRole('alert').filter({ hasText: 'Could not load' }).waitFor()
  await keyboardRetry('Retry'); await noteIs('A current saved research')
  await record('Initial read error still locks Note/Clear and has distinct keyboard Retry that reads original without saving')
  await editor().fill('A outgoing loaded edit'); await tab('Details')
  assert.equal((await read(a.slug)).body, 'A outgoing loaded edit')
  await tab('Notes'); await noteIs('A outgoing loaded edit')
  await editor().fill('A final intentional saved note'); await saved()
  await record('Normal loaded debounce and quick Notes unmount flush remain functional')
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
  await record('Final restart retains final edit, unrelated note/history message and byte-identical ingested PDFs')
  const consoleLines = launches.flatMap((instance) => instance.consoleLines)
  assertNoConsoleErrors(consoleLines)
  await record('Zero renderer errors, warnings or page errors across four launches')
  fs.writeFileSync(path.join(evidence, 'live-results.json'), JSON.stringify({ results, consoleLines, paperHashes: fileHashes }, null, 2) + '\n')
} catch (error) {
  await captureFailureArtifacts('notes-load-165', { window, consoleLines: launches.flatMap((instance) => instance.consoleLines) })
  throw error
} finally {
  if (app) await app.close()
  // Keep isolated data for independent parent inspection; no personal state.
  console.log(`Isolated run data: ${root}`)
}
