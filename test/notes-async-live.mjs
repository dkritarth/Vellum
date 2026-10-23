// Issue #92 only. Run after npm run build and Electron native-dependency setup:
// xvfb-run -a node test/notes-async-live.mjs /path/attention.pdf /path/bert.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchIsolatedApp, captureFailureArtifacts, assertNoConsoleErrors, ROOT } from './harness.mjs'

const papers = process.argv.slice(2)
assert.equal(papers.length, 2, 'Pass two distinct real paper PDF paths')
for (const paper of papers) assert(fs.existsSync(paper), `Missing PDF: ${paper}`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-92-'))
const evidence = path.join(ROOT, 'test-artifacts/issue-92')
fs.mkdirSync(evidence, { recursive: true })
const bin = path.join(root, 'bin')
fs.mkdirSync(bin)
for (const adapter of ['codex-acp', 'claude-code-acp']) {
  fs.writeFileSync(path.join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
}
process.env.PATH = `${bin}:${process.env.PATH}`
process.env.XDG_CONFIG_HOME = path.join(root, 'config')
process.env.XDG_CACHE_HOME = path.join(root, 'cache')
let app
let window
const launches = []
const results = []
async function launch() {
  const instance = await launchIsolatedApp({ dataDir: path.join(root, 'data') })
  launches.push(instance)
  app = instance.app
  window = instance.window
  await window.waitForSelector('footer:has-text("bridge: pong")')
}
async function noteIs(body) {
  await window.waitForFunction((expected) => document.querySelector('textarea[aria-label="Note"]')?.value === expected, body)
}
async function saved() { await window.getByText('Saved', { exact: true }).waitFor() }
async function rendered() {
  await window.waitForFunction(() => {
    const canvas = document.querySelector('canvas')
    return canvas?.width > 0 && document.querySelectorAll('[class*="textLayer"] span').length > 0
  })
}
async function read(slug) { return window.evaluate((s) => window.vellum.notesGet(s), slug) }
async function select(title) {
  await window.getByRole('tablist', { name: 'Open papers' }).getByRole('tab', { name: title, exact: true }).click()
}
async function arm(channel, slug, outcome) {
  await app.evaluate(({ ipcMain }, config) => {
    globalThis.__vellum92.hold = config
  }, { channel, slug, outcome })
}
async function pending() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await app.evaluate(() => Boolean(globalThis.__vellum92.pending))) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Controlled IPC request did not start')
}
async function release() {
  await app.evaluate(() => {
    const state = globalThis.__vellum92
    state.pending()
    state.pending = null
  })
  // Await an unrelated IPC round trip, then a renderer frame, so assertions
  // observe the settled callback rather than the state before its delivery.
  await window.evaluate(async () => {
    await window.vellum.ping()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}
async function record(message) {
  results.push(message)
  console.log(`PASS ${message}`)
}
try {
  await launch()
  await window.getByRole('tab', { name: 'Notes', exact: true }).click()
  await window.getByText('Open a paper to add notes.', { exact: true }).waitFor()
  for (const paper of papers) {
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    const input = window.getByRole('textbox', { name: 'Paper identifier or URL' })
    await input.fill(path.resolve(paper))
    await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
    await window.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 })
    await rendered()
  }
  const stored = await window.evaluate(() => window.vellum.listPapers())
  const a = stored.find((paper) => paper.title === path.resolve(papers[0]))
  const b = stored.find((paper) => paper.title === path.resolve(papers[1]))
  assert(a && b && a.slug !== b.slug, 'Both real papers must be independently ingested')
  const editor = window.getByRole('textbox', { name: 'Note', exact: true })
  await editor.fill('B original')
  await saved()
  await select(a.title)
  await editor.fill('A original')
  await saved()
  assert(await editor.evaluate((element) => element === document.activeElement), 'Editor keeps keyboard focus')
  await record('Visible empty state, two real PDF ingests/renders, labeled editor, focus and debounced saves')

  // Test-only reply control. The existing production handler still performs
  // successful writes. Electron 32's private map is used only to retain it:
  // https://github.com/electron/electron/blob/v32.3.3/lib/browser/ipc-main-impl.ts
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.__vellum92 = { hold: null, pending: null, calls: [] }
    for (const channel of ['vellum:notes-delete', 'vellum:notes-save']) {
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error(`Missing production handler ${channel}`)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (event, params) => {
        const slug = typeof params === 'string' ? params : params.slug
        state.calls.push({ channel, params })
        const hold = state.hold
        if (!hold || hold.channel !== channel || hold.slug !== slug) return original(event, params)
        state.hold = null
        const result = hold.outcome === 'resolve' ? original(event, params) : undefined
        return new Promise((resolve, reject) => {
          state.pending = () => hold.outcome === 'resolve' ? resolve(result) : reject(new Error('issue-92 controlled failure'))
        })
      })
    }
  })

  await arm('vellum:notes-delete', a.slug, 'reject')
  await window.getByRole('button', { name: 'Clear note' }).click()
  await pending()
  await select(b.title)
  await noteIs('B original')
  await editor.fill('B survives delayed A Clear')
  await release()
  await noteIs('B survives delayed A Clear')
  await select(a.title)
  assert.equal((await read(b.slug)).body, 'B survives delayed A Clear')
  await noteIs('A original')
  await select(b.title)
  await noteIs('B survives delayed A Clear')
  await rendered()
  await window.screenshot({ path: path.join(evidence, 'clear-failure-isolated.png') })
  await select(a.title)
  await noteIs('A original')
  await record('Delayed Clear(A) rejection preserves B and outgoing flush persists B under B only')

  await arm('vellum:notes-delete', a.slug, 'reject')
  await window.getByRole('button', { name: 'Clear note' }).click()
  await pending()
  await release()
  await noteIs('A original')
  await select(b.title)
  assert.equal((await read(a.slug)).body, 'A original')
  await record('Current Clear failure restores A and normal outgoing flush retries it')

  for (const outcome of ['resolve', 'reject']) {
    await select(a.title)
    await arm('vellum:notes-save', a.slug, outcome)
    await editor.fill(`A older save ${outcome}`)
    await pending()
    await select(b.title)
    await editor.fill(`B newest ${outcome}`)
    await saved()
    await release()
    await noteIs(`B newest ${outcome}`)
    await saved()
    assert.equal((await read(b.slug)).body, `B newest ${outcome}`)
    await record(`Outgoing autosave ${outcome} preserves B's newer editor and Saved status`)
  }

  await select(a.title)
  await arm('vellum:notes-save', a.slug, 'reject')
  await editor.fill('A outgoing flush failure')
  await select(b.title)
  await pending()
  await editor.fill('B final persisted note')
  await saved()
  const before = await app.evaluate(() => globalThis.__vellum92.calls.length)
  await release()
  await saved()
  await select(a.title)
  const after = await app.evaluate(() => globalThis.__vellum92.calls.length)
  assert.equal(after, before, 'Stale flush failure must not trigger a redundant B save')
  await record('Outgoing flush failure cannot dirty B or clear its Saved status')

  await editor.fill('A final persisted note')
  await saved()
  await window.getByRole('button', { name: 'Clear note' }).click()
  await noteIs('')
  assert(await window.getByRole('button', { name: 'Clear note' }).isDisabled())
  assert.equal(await read(a.slug), null)
  await editor.fill('A final persisted note')
  await saved()
  await record('Normal Clear removes persisted note and disables empty action; typing saves again')
  await app.close()
  app = null
  await launch()
  await window.getByRole('tab', { name: 'Notes', exact: true }).click()
  for (const [paper, expected] of [[a, 'A final persisted note'], [b, 'B final persisted note']]) {
    await window.getByRole('button', { name: 'Library', exact: true }).click()
    await window.getByRole('button', { name: paper.title, exact: true }).click()
    await noteIs(expected)
    await rendered()
    assert.equal((await read(paper.slug)).body, expected)
  }
  await window.screenshot({ path: path.join(evidence, 'restart-two-papers.png') })
  await record('Full Electron restart retains distinct A/B notes through visible Library and paper controls')
  const consoleLines = launches.flatMap((instance) => instance.consoleLines)
  assertNoConsoleErrors(consoleLines)
  await record('Renderer console has no errors, warnings or page errors across both launches')
  fs.writeFileSync(path.join(evidence, 'renderer-console.log'), consoleLines.join('\n'))
  fs.writeFileSync(path.join(evidence, 'live-results.json'), JSON.stringify({ papers: [a.slug, b.slug], results, consoleLines }, null, 2))
} catch (error) {
  await captureFailureArtifacts('notes-async-92', { window, consoleLines: launches.flatMap((instance) => instance.consoleLines) })
  throw error
} finally {
  if (app) await app.close()
  fs.rmSync(root, { recursive: true, force: true })
}
