// Live Electron check for the app UX sweep (#191-#197). Drives the built app
// like a user: ingest through the Add Paper dialog, tabs, sidebar nav,
// collections (drag-and-drop, card control, keyboard), Trash/Usage layout.
//
// Usage: npm run build && xvfb-run -a node test/app-ux-live.mjs [pdfA] [pdfB]
// Defaults to the repo fixtures; pass real papers (e.g. arXiv 1706.03762 and
// 2005.14165) for real-paper evidence. Set VELLUM_UX_SHOTS=<dir> to keep
// screenshots.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  launchIsolatedApp,
  captureFailureArtifacts,
  assertNoConsoleErrors,
  cleanupIsolatedApp,
} from './harness.mjs'

const pdfA = path.resolve(process.argv[2] || path.join(ROOT, 'core/ingest/fixtures/sample.pdf'))
const pdfB = path.resolve(process.argv[3] || path.join(ROOT, 'core/ingest/fixtures/sample2.pdf'))
const shotsDir = process.env.VELLUM_UX_SHOTS
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true })

const { app, window: w, consoleLines, dataDir } = await launchIsolatedApp()
const shot = async (name) => {
  if (shotsDir) await w.screenshot({ path: path.join(shotsDir, `${name}.png`) })
}
const step = (msg) => console.log(`• ${msg}`)
let passed = false

try {
  await w.setViewportSize({ width: 1280, height: 800 })
  const nav = w.getByRole('navigation', { name: 'Primary' })
  const highlighted = () =>
    nav.locator('[aria-current="page"], [aria-pressed="true"]').allTextContents()
  const tabs = () => w.locator('[aria-label="Open papers"] [role=tab]').allTextContents()
  const pageOverflows = () =>
    w.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)

  // #192 — Add Paper dialog: readable error, clean on reopen.
  await nav.getByRole('button', { name: 'Create' }).click()
  await w.fill('#paper-input', '/nonexistent/paper.pdf')
  await w.getByRole('button', { name: 'Add Paper' }).click()
  const alert = w.getByRole('dialog').getByRole('alert')
  await alert.waitFor()
  const errorText = await alert.textContent()
  assert.strictEqual(errorText, 'Local PDF not found: /nonexistent/paper.pdf')
  await shot('01-ingest-error')
  await w.getByRole('button', { name: 'Cancel' }).click()
  // #194 — Create is not sticky.
  assert.deepStrictEqual(await highlighted(), ['Home'])
  await nav.getByRole('button', { name: 'Create' }).click()
  assert.strictEqual(await w.inputValue('#paper-input'), '')
  assert.strictEqual(await w.getByRole('dialog').getByRole('alert').count(), 0)
  step(`ingest error reads "${errorText}"; dialog reopens clean; Create not sticky`)

  // #191 — ingest real PDFs through the dialog; titles are not paths.
  for (const pdf of [pdfA, pdfB]) {
    if (!(await w.getByRole('dialog').count())) await nav.getByRole('button', { name: 'Create' }).click()
    await w.fill('#paper-input', pdf)
    await w.getByRole('button', { name: 'Add Paper' }).click()
    await w.getByRole('dialog').waitFor({ state: 'detached', timeout: 180000 })
  }
  const titles = await tabs()
  assert.strictEqual(titles.length, 2)
  for (const title of titles) assert.ok(!title.includes('/') && !/\.pdf$/i.test(title), `title looks like a path: ${title}`)
  step(`ingested tabs titled ${JSON.stringify(titles)}`)
  await shot('02-ingested-titles')

  // #193 — tabs close; + opens Library.
  await w.getByRole('button', { name: `Close ${titles[1]}` }).click()
  assert.deepStrictEqual(await tabs(), [titles[0]])
  assert.strictEqual(await w.locator('[aria-label="Open papers"] [role=tab][aria-selected=true]').textContent(), titles[0])
  await w.getByRole('tab', { name: titles[0] }).click({ button: 'middle' })
  assert.deepStrictEqual(await tabs(), [])
  await w.getByRole('button', { name: 'Open another paper' }).click()
  await w.getByLabel('Search papers by title').waitFor()
  assert.deepStrictEqual(await highlighted(), ['Library'])
  step('close button + middle-click close tabs; + opens Library')

  // #194 — Search focuses the box; highlight follows Trash/Usage.
  await nav.getByRole('button', { name: 'Search' }).click()
  assert.strictEqual(await w.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search papers by title')
  assert.deepStrictEqual(await highlighted(), ['Search'])

  // #195 — Trash/Usage fill the pane with no page scrollbar.
  for (const name of ['Trash', 'Usage']) {
    await nav.getByRole('button', { name, exact: true }).click()
    await w.waitForTimeout(400)
    assert.deepStrictEqual(await highlighted(), [name])
    assert.strictEqual(await pageOverflows(), false, `${name} makes the window scroll`)
    const widths = await w.evaluate(() => {
      const main = document.querySelector('main')
      const view = main?.firstElementChild
      return [main?.getBoundingClientRect().width, view?.getBoundingClientRect().width]
    })
    assert.ok(Math.abs(widths[0] - widths[1]) < 2, `${name} view ${widths[1]}px does not fill pane ${widths[0]}px`)
    await shot(`03-${name.toLowerCase()}`)
  }
  step('Trash/Usage highlighted, fill the pane, no page scroll')

  // #196 — collections: create, drag a card onto it, card control, remove.
  await nav.getByRole('button', { name: 'Library' }).click()
  await w.getByRole('button', { name: 'New Collection' }).click()
  await w.keyboard.type('Reading')
  await w.keyboard.press('Enter')
  const readingRow = w.locator('[role=treeitem]', { hasText: 'Reading' })
  await readingRow.waitFor()
  await nav.getByRole('button', { name: 'Library' }).click()
  const cardA = w.locator('[aria-label=Papers] [role=listitem]', { hasText: titles[0] })
  await cardA.dragTo(readingRow)
  await w.waitForFunction(() => {
    const row = [...document.querySelectorAll('[role=treeitem]')].find((el) => el.textContent?.includes('Reading'))
    return row?.textContent?.includes('1')
  })
  await cardA.getByText('Reading', { exact: true }).waitFor()
  step('dragging a Library card onto "Reading" assigned it (count 1, tag shown)')
  await w.getByRole('combobox', { name: `Add ${titles[1]} to a collection` }).selectOption({ label: 'Reading' })
  await w.locator('[aria-label=Papers] [role=listitem]', { hasText: titles[1] }).getByText('Reading', { exact: true }).waitFor()
  await shot('04-collection-tags')

  // #197 — keyboard: focus the row and press Enter.
  await readingRow.focus()
  await w.keyboard.press('Enter')
  await w.getByText('Filtered by collection:').waitFor()
  assert.strictEqual(await w.locator('[aria-label=Papers] [role=listitem]').count(), 2)
  await shot('05-collection-filter')
  await w.getByRole('button', { name: `Remove ${titles[1]} from Reading` }).click()
  await w.waitForFunction(() => document.querySelectorAll('[aria-label=Papers] [role=listitem]').length === 1)
  await w.getByRole('button', { name: `Remove ${titles[0]} from Reading` }).click()
  await w.getByText(/No papers in this collection yet/).waitFor()
  await shot('06-collection-empty')
  step('keyboard Enter filtered by "Reading"; remove-from-collection and empty state work')

  assertNoConsoleErrors(consoleLines)
  passed = true
  console.log('APP UX LIVE: PASS')
} catch (err) {
  console.error('APP UX LIVE: FAIL', err)
  await captureFailureArtifacts('app-ux-live', { window: w, consoleLines })
  process.exitCode = 1
} finally {
  await cleanupIsolatedApp(app, dataDir)
  if (!passed) process.exitCode = 1
}
