// Opt-in, signed-in, real-paper walkthrough. Records the production Electron
// renderer and uses visible controls. No ACP or successful storage replies stubbed.
// Build first. Run under a desktop session or xvfb-run with two real paper PDFs:
// node test/walkthrough-live.mjs /path/attention.pdf /path/second-paper.pdf [output-dir]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdfs = process.argv.slice(2, 4).map((file) => path.resolve(file))
assert.equal(pdfs.length, 2, 'Pass two distinct real paper PDFs; the first must be Attention Is All You Need')
assert.notEqual(pdfs[0], pdfs[1])
for (const pdf of pdfs) assert(fs.existsSync(pdf), `Missing PDF: ${pdf}`)
const evidence = path.resolve(process.argv[4] ?? path.join(ROOT, 'test-artifacts', 'walkthrough'))
fs.mkdirSync(evidence, { recursive: true })
const provenance = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '',
  build: Object.fromEntries(['out/main/index.cjs', 'out/renderer/index.html'].map((file) => [
    file, createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex'),
  ])),
}
const chapters = []
const logs = []
const videos = []
let active
let window
let dataDir
let segmentStart
let segment = 0
let passed = false
let failure
const note = 'Transformer: attention replaces recurrence. Compare parallelism and sequence length costs.'
const nav = () => window.getByRole('navigation', { name: 'Primary' })
const button = (name) => window.getByRole('button', { name, exact: true })
const tab = (name) => window.getByRole('tab', { name, exact: true })
const paperTab = (name) => window.getByRole('tablist', { name: 'Open papers' }).getByRole('tab', { name, exact: true })
const composer = () => window.getByRole('textbox', { name: 'Ask a question', exact: true })
const answers = () => window.locator('[class*=assistantMessage]')
const chats = () => window.getByRole('listbox', { name: 'Chat sessions' }).getByRole('option')

async function launch() {
  segment += 1
  segmentStart = Date.now()
  active = await launchIsolatedApp({
    dataDir,
    recordVideo: {
      dir: path.join(evidence, 'raw-video'), size: { width: 1440, height: 900 },
      showActions: { cursor: 'pointer', duration: 500, fontSize: 14, position: 'top-right' },
    },
  })
  dataDir = active.dataDir
  window = active.window
  window.setDefaultTimeout(20_000)
  await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await window.getByText('bridge: pong', { exact: true }).waitFor()
}

async function close() {
  if (!active) return
  const video = window.video()
  const target = path.join(evidence, `walkthrough-${segment}.webm`)
  logs.push(...active.consoleLines)
  await active.app.close()
  active = undefined
  await video.saveAs(target)
  videos.push(target)
}

async function chapter(name, action) {
  const entry = { name, segment, seconds: Math.round((Date.now() - segmentStart) / 1000), passed: false }
  chapters.push(entry)
  await action()
  await window.screenshot({ path: path.join(evidence, `${String(chapters.length).padStart(2, '0')}.png`) })
  // A short hold makes each resulting state readable in the recording.
  await window.waitForTimeout(700)
  entry.passed = true
  console.log(`PASS [${segment}:${entry.seconds}s] ${name}`)
}

async function rendered(page = 1) {
  await window.waitForFunction((page) => {
    const slot = document.querySelector(`[data-page-number="${page}"]`)
    return slot?.querySelector('canvas')?.width > 0 && slot.querySelector('[data-text-layer]')?.textContent.length > 0
  }, page)
}

async function selectText(text, page = 1) {
  const span = window.locator(`[data-page-number="${page}"] [data-text-layer] span`).filter({ hasText: text }).first()
  await span.scrollIntoViewIfNeeded()
  // A drag starting inside an existing selection drags that selection in
  // Chromium. Click first to collapse it before making a fresh selection.
  await span.click()
  const box = await span.boundingBox()
  assert(box && box.width > 3)
  await window.mouse.move(box.x + 1, box.y + box.height / 2)
  await window.mouse.down()
  await window.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 })
  await window.mouse.up()
  return window.evaluate(() => getSelection().toString())
}

async function completedAnswer(previousCount) {
  await window.waitForFunction((count) => {
    const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
    const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
    return document.querySelector('[role=alert]') || (messages.length > count && messages.at(-1).textContent.length > 10 && !sending)
  }, previousCount, { timeout: 180_000 })
  assert.equal(await window.getByRole('alert').count(), 0, 'Chat must finish without an error')
  return answers().last().innerText()
}

try {
  await launch()
  await chapter('Empty workspace and deferred features', async () => {
    await window.getByText('No paper open', { exact: true }).waitFor()
    assert(await composer().isDisabled())
    for (const name of ['Notes', 'Details', 'Annotations', 'Ask']) await tab(name).click()
    await button('Switch workspace').click()
    await window.getByText('Workspaces — coming soon', { exact: true }).waitFor()
    await button('Switch workspace').click()
    await button('Skills').click()
    await window.getByText('Skills — coming soon', { exact: true }).waitFor()
    await button('Skills').click()
    await button('Context').click()
    await window.getByText('Context — coming soon', { exact: true }).waitFor()
    await button('Context').click()
  })
  await chapter('Import error and clean retry dialog', async () => {
    await nav().getByRole('button', { name: 'Create', exact: true }).click()
    await window.getByLabel('Paper identifier or URL').fill('/nonexistent/walkthrough.pdf')
    await button('Add Paper').click()
    await window.getByRole('alert').filter({ hasText: 'Local PDF not found:' }).waitFor()
    await window.keyboard.press('Escape')
    // Keyboard dispatch can resolve before React unmounts the old dialog.
    // Wait for that transition before checking the newly opened input.
    await window.getByRole('dialog').waitFor({ state: 'detached' })
    await nav().getByRole('button', { name: 'Create', exact: true }).click()
    assert.equal(await window.getByLabel('Paper identifier or URL').inputValue(), '')
    await button('Cancel').click()
  })
  for (const [index, pdf] of pdfs.entries()) {
    await chapter(`Import real paper ${index + 1} through Add Paper`, async () => {
      await nav().getByRole('button', { name: 'Create', exact: true }).click()
      await window.getByLabel('Paper identifier or URL').fill(pdf)
      await button('Add Paper').click()
      await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 180_000 })
      await rendered()
    })
  }
  const titles = await window.locator('[aria-label="Open papers"] [role=tab]').allTextContents()
  assert.equal(titles.length, 2)
  const [first, second] = titles
  await paperTab(first).click()
  await rendered()

  await chapter('Reader continuous scroll, navigation, and outline', async () => {
    await button('Next page').click()
    await rendered(2)
    assert.match(await window.getByLabel('Page', { exact: true }).innerText(), /^2 of/)
    await button('Previous page').click()
    await rendered()
    const viewport = await window.locator('[data-reader-viewport]').boundingBox()
    await window.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
    await window.mouse.wheel(0, 1500)
    await window.waitForFunction(() => !document.querySelector('[aria-label="Page"]').textContent.startsWith('1 of'))
    await button('Outline').click()
    await window.getByRole('navigation', { name: 'Table of contents' }).waitFor()
    const target = window.getByRole('navigation', { name: 'Table of contents' }).locator('button:enabled').first()
    if (await target.count()) await target.click()
    else await window.getByText('No outline in this PDF.', { exact: true }).waitFor()
    await button('Outline').click()
  })
  await chapter('Pinch zoom and reader keyboard shortcuts', async () => {
    const viewport = window.locator('[data-reader-viewport]')
    const box = await viewport.boundingBox()
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const before = await window.getByLabel('Zoom', { exact: true }).innerText()
    await window.keyboard.down('Control')
    await window.mouse.wheel(0, -100)
    await window.keyboard.up('Control')
    await window.waitForFunction((before) => document.querySelector('[aria-label="Zoom"]').textContent !== before, before)
    await viewport.focus()
    await window.keyboard.press('Control+0')
    await window.getByLabel('Zoom', { exact: true }).filter({ hasText: '100%' }).waitFor()
    await window.keyboard.press('Control+=')
    await window.getByLabel('Zoom', { exact: true }).filter({ hasText: '125%' }).waitFor()
    await window.keyboard.press('Control+-')
    await window.getByLabel('Zoom', { exact: true }).filter({ hasText: '100%' }).waitFor()
  })
  await chapter('Document search matches, navigation, and empty results', async () => {
    const search = window.getByRole('searchbox', { name: 'Search in document' })
    await search.fill('attention')
    await search.press('Enter')
    await window.getByLabel('Search matches', { exact: true }).filter({ hasText: /^1\s*\// }).waitFor()
    await button('Next match').click()
    await window.getByLabel('Search matches', { exact: true }).filter({ hasText: /^2\s*\// }).waitFor()
    await button('Previous match').click()
    await search.fill('zzzz-unmatched-walkthrough')
    await search.press('Enter')
    await window.getByLabel('Search matches', { exact: true }).filter({ hasText: '0 / 0' }).waitFor()
    await search.fill('')
    await search.press('Enter')
  })
  await chapter('Citation hover and reference navigation', async () => {
    await button('Next page').click()
    await rendered(2)
    const marker = window.locator('[data-page-number="2"] [data-citation-number]').first()
    await marker.scrollIntoViewIfNeeded()
    await marker.hover()
    await window.getByRole('tooltip').waitFor()
    await marker.click()
    await window.waitForFunction(() => Number(document.querySelector('[aria-label="Page"]').textContent.split(' of ')[0]) > 2)
    const search = window.getByRole('searchbox', { name: 'Search in document' })
    await search.fill('Abstract')
    await search.press('Enter')
    await window.getByLabel('Search matches', { exact: true }).filter({ hasText: /^1\s*\// }).waitFor()
    await rendered()
    await search.fill('')
    await search.press('Enter')
  })
  await chapter('Model selection, mouse selection, and Add to chat', async () => {
    await tab('Ask').click()
    await window.getByRole('combobox', { name: 'Model backend' }).selectOption('codex')
    const quote = await selectText('Abstract')
    assert(quote.length > 3)
    await button('Add to chat').click()
    assert((await composer().inputValue()).includes(quote))
    const count = await answers().count()
    await composer().fill((await composer().inputValue()) + '\nWhat architecture does this paper introduce? Answer in two sentences with a section reference.')
    await button('Send').click()
    assert.match(await completedAnswer(count), /Transformer/i)
  })
  await chapter('Selection Explain with signed-in Codex', async () => {
    const count = await answers().count()
    await selectText('Abstract')
    await button('Explain').click()
    assert((await completedAnswer(count)).length > 30)
  })
  await chapter('Suggested questions refresh and send', async () => {
    await button('Regenerate suggested questions').click()
    await window.waitForFunction(() => !document.querySelector('[aria-label="Regenerate suggested questions"]').disabled)
    const question = window.getByRole('group', { name: 'Questions list' }).getByRole('button').first()
    await question.waitFor()
    const count = await answers().count()
    await question.click()
    assert((await completedAnswer(count)).length > 30)
  })
  for (const action of ['Breakdown', 'Practice questions', 'Study guide']) {
    await chapter(`Quick action: ${action}`, async () => {
      const count = await answers().count()
      await button(action).click()
      assert((await completedAnswer(count)).length > 30)
    })
  }
  await chapter('Context-menu highlight and annotation navigation', async () => {
    await selectText('Abstract')
    await button('Highlight yellow').click()
    await tab('Annotations').click()
    await window.getByRole('button', { name: /^Abstract.*Page 1$/ }).waitFor()
    await window.getByRole('button', { name: /^Abstract.*Page 1$/ }).click()
    await rendered()
  })
  await chapter('Highlight tool, color selection, and deletion', async () => {
    await button('Highlight').click()
    await button('green highlight color').click()
    await selectText('Introduction', 2)
    await window.getByRole('button', { name: /^Introduction.*Page 2$/ }).waitFor()
    await button('Highlight').click()
    await button('Delete highlight: Introduction').click()
    await button('Delete highlight: Introduction').waitFor({ state: 'detached' })
    assert.equal(await window.getByRole('button', { name: 'Delete highlight: Abstract', exact: true }).count(), 1)
  })
  await chapter('Notes autosave and paper isolation', async () => {
    await tab('Notes').click()
    await window.getByRole('textbox', { name: 'Note', exact: true }).fill(note)
    await window.getByText('Saved', { exact: true }).waitFor()
    await paperTab(second).click()
    await window.waitForFunction(() => document.querySelector('[aria-label="Note"]')?.value === '')
    await window.getByRole('textbox', { name: 'Note', exact: true }).fill('Second paper has an independent note.')
    await window.getByText('Saved', { exact: true }).waitFor()
    await paperTab(first).click()
    await window.waitForFunction((note) => document.querySelector('[aria-label="Note"]')?.value === note, note)
  })
  await chapter('Stored paper details', async () => {
    await tab('Details').click()
    await window.locator('aside').getByRole('heading', { name: first, exact: true }).waitFor()
  })
  await chapter('Tab close, Library shortcut, and reopen', async () => {
    await button(`Close ${second}`).click()
    assert.equal(await paperTab(second).count(), 0)
    await button('Open another paper').click()
    await button(second).click()
    await rendered()
    await paperTab(first).click()
    await rendered()
  })
  await chapter('Panel resizing, collapse, restore, and keyboard focus', async () => {
    const handle = window.getByRole('separator', { name: 'Resize paper panel' })
    await handle.focus()
    const width = Number(await handle.getAttribute('aria-valuenow'))
    await window.keyboard.press('ArrowLeft')
    assert(Number(await handle.getAttribute('aria-valuenow')) > width)
    await window.keyboard.press('Home')
    await button('Hide paper panel').click()
    await button('Show paper panel').click()
    await button('Hide sidebar').click()
    await button('Show sidebar').click()
  })
  await chapter('Library search, sort, and collection assignment', async () => {
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
    const search = window.getByRole('searchbox', { name: 'Search papers by title' })
    await search.fill('zzzz-no-paper')
    await window.getByText('No papers match your search.', { exact: true }).waitFor()
    await search.fill('')
    await window.getByRole('combobox', { name: 'Sort papers' }).selectOption({ label: 'Title' })
    await window.waitForFunction((expected) => {
      const names = [...document.querySelectorAll('[aria-label="Papers"] [role=listitem]')]
        .map((card) => card.querySelector('button').textContent.trim())
      return JSON.stringify(names) === JSON.stringify(expected)
    }, [...titles].sort((a, b) => a.localeCompare(b)))
    await button('New Collection').click()
    await window.keyboard.type('Walkthrough')
    await window.keyboard.press('Enter')
    const collection = window.getByRole('treeitem').filter({ hasText: 'Walkthrough' })
    await collection.waitFor()
    // Creation intentionally selects the new, initially empty collection.
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
    await window.getByRole('combobox', { name: `Add to collection: ${first}` }).selectOption({ label: 'Walkthrough' })
    await collection.focus()
    await window.keyboard.press('Enter')
    await window.getByText('Filtered by collection:').waitFor()
    assert.equal(await window.locator('[aria-label="Papers"] [role=listitem]').count(), 1)
    await button(`Remove from collection: ${first}`).click()
    await window.getByText(/^No papers in this collection yet/).waitFor()
    await button('Rename Walkthrough').click()
    await window.keyboard.press('Control+a')
    await window.keyboard.type('Reading')
    await window.keyboard.press('Enter')
    await window.getByRole('treeitem').filter({ hasText: 'Reading' }).waitFor()
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
  })
  await chapter('Trash, restore, and purge confirmation cancellation', async () => {
    await button(`Move ${second} to trash`).click()
    await nav().getByRole('button', { name: 'Trash', exact: true }).click()
    await button(`Delete ${second} permanently`).click()
    await window.getByRole('dialog', { name: 'Permanently delete paper?' }).waitFor()
    await window.keyboard.press('Escape')
    await tab('Chats').click()
    const chat = chats().filter({ hasText: second }).first()
    await chat.click()
    await window.getByRole('alert').filter({ hasText: 'Restore it from Trash to open this conversation.' }).waitFor()
    assert.equal(await paperTab(second).count(), 0)
    await nav().getByRole('button', { name: 'Trash', exact: true }).click()
    await button(`Restore ${second}`).click()
    await window.getByText('Trash is empty', { exact: true }).waitFor()
    await chat.click()
    await paperTab(second).waitFor()
    assert.equal(await window.getByRole('alert').count(), 0)
    await paperTab(first).click()
  })
  await chapter('Authentic usage telemetry and refresh', async () => {
    await nav().getByRole('button', { name: 'Usage', exact: true }).click()
    await window.getByRole('heading', { name: 'ACP Usage & Plan Telemetry' }).waitFor()
    await button('Refresh usage data').click()
    await window.getByRole('button', { name: 'Refresh usage data', disabled: false }).waitFor()
    assert.equal(await window.getByRole('alert').count(), 0)
  })
  await chapter('Chat library search and session reopening', async () => {
    await tab('Chats').click()
    const search = window.getByRole('searchbox', { name: 'Search chats' })
    await search.fill('zzzz-no-conversation')
    await window.getByText('No chats matching "zzzz-no-conversation"', { exact: true }).waitFor()
    await search.fill('')
    await chats().filter({ hasText: 'Codex' }).first().click()
    await tab('Ask').click()
    await answers().filter({ hasText: /Transformer/i }).first().waitFor()
  })
  await close()
  await launch()
  await chapter('Restart restores library, notes, annotations, and conversation', async () => {
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
    await button(first).click()
    await rendered()
    await tab('Notes').click()
    await window.waitForFunction((note) => document.querySelector('[aria-label="Note"]')?.value === note, note)
    await tab('Annotations').click()
    await button('Delete highlight: Abstract').waitFor()
    await tab('Chats').click()
    await chats().filter({ hasText: 'Codex' }).first().click()
    await tab('Ask').click()
    await answers().filter({ hasText: /Transformer/i }).first().waitFor()
  })
  await chapter('New chat and isolated conversation deletion', async () => {
    await button('New chat').click()
    await window.waitForFunction(() => document.querySelectorAll('[class*=assistantMessage]').length === 0)
    await tab('Chats').click()
    // Sidebar polling may still show the old list just after New chat, and
    // the second paper has its own empty Codex chat. Wait for this paper's
    // new empty row, then delete that exact conversation.
    const empty = chats().filter({ hasText: first }).filter({ hasText: 'Codex' }).filter({ hasText: /(^|\D)0 turns/ }).first()
    const original = chats().filter({ hasText: first }).filter({ hasText: 'Codex' }).filter({ hasNotText: /(^|\D)0 turns/ }).first()
    await empty.waitFor()
    // Re-selecting the chat that was open before New chat must reload it (#256).
    await original.click()
    await answers().filter({ hasText: /Transformer/i }).first().waitFor()
    await window.waitForFunction(() => document.querySelector('[role=listbox][aria-label="Chat sessions"] [aria-selected=true]')?.textContent?.includes('0 turns') === false)
    const label = await empty.getByRole('button', { name: /^Delete chat / }).getAttribute('aria-label')
    assert(label)
    window.once('dialog', (dialog) => dialog.accept())
    await button(label).click()
    await button(label).waitFor({ state: 'detached' })
    // Deleting a conversation that is not displayed leaves Ask untouched.
    await answers().filter({ hasText: /Transformer/i }).first().waitFor()
    await original.click()
    await answers().filter({ hasText: /Transformer/i }).first().waitFor()
    // Clicking the chat Ask already shows keeps the unsent draft.
    await composer().fill('Unsent draft survives re-click')
    await original.click()
    await window.waitForTimeout(500)
    assert.equal(await composer().inputValue(), 'Unsent draft survives re-click')
    await answers().filter({ hasText: /Transformer/i }).first().waitFor()
    await composer().fill('')
  })
  await chapter('Clear note, delete collection, and permanently purge isolated paper', async () => {
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
    await button(second).click()
    await rendered()
    await tab('Notes').click()
    await button('Clear note').click()
    await window.getByText('Cleared', { exact: true }).waitFor()
    assert.equal(await window.getByRole('textbox', { name: 'Note', exact: true }).inputValue(), '')
    await tab('Files').click()
    window.once('dialog', (dialog) => dialog.accept())
    await button('Delete Reading').click()
    await window.getByRole('treeitem').filter({ hasText: 'Reading' }).waitFor({ state: 'detached' })
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
    await button(`Move ${second} to trash`).click()
    await nav().getByRole('button', { name: 'Trash', exact: true }).click()
    await button(`Delete ${second} permanently`).click()
    await button('Confirm purge').click()
    await window.getByRole('dialog').waitFor({ state: 'detached' })
    await window.getByText('Trash is empty', { exact: true }).waitFor()
    await nav().getByRole('button', { name: 'Library', exact: true }).click()
    await button(first).waitFor()
    assert.equal(await button(second).count(), 0)
  })
  assertNoConsoleErrors([...logs, ...active.consoleLines])
  passed = true
} catch (error) {
  failure = error
  await captureFailureArtifacts('walkthrough', { window, consoleLines: [...logs, ...(active?.consoleLines ?? [])] })
  throw error
} finally {
  let finalizationError
  try {
    await close()
  } catch (error) {
    finalizationError = error
    passed = false
    console.error('Video finalization failed:', error)
  } finally {
    // Keep cleanup and diagnostic writes independent of Electron/video shutdown.
    await cleanupIsolatedApp(active?.app, dataDir)
    if (!finalizationError) fs.rmSync(path.join(evidence, 'raw-video'), { recursive: true, force: true })
    fs.writeFileSync(path.join(evidence, 'console.log'), logs.join('\n'))
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
      passed, provenance, pdfs, videos, chapters,
      failure: failure ? String(failure) : undefined,
      finalizationError: finalizationError ? String(finalizationError) : undefined,
      limitations: ['Claude and Gemini backend answers are not certified by this Codex walkthrough.',
        'Workspace switching and slash/context pickers are shown as deferred features.'],
    }, null, 2))
    console.log(`${passed ? 'PASS' : 'FAIL'}: walkthrough evidence ${evidence}`)
  }
  if (finalizationError && !failure) throw finalizationError
}
