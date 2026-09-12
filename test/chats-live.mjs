// Live Electron verification script for [L2-02] Cross-paper Chats library and session reopening
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'node:assert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function runLiveVerification() {
  console.log('=== [L2-02] Live Chats Library Verification Starting ===')

  // 1. Launch instance 1
  console.log('1. Launching Electron App (Instance 1)...')
  const app = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'out/main/index.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Verify IPC bridge
  const pong = await window.evaluate(() => window.vellum.ping())
  assert.strictEqual(pong, 'pong')

  // Ingest sample papers
  const pdf1 = path.join(ROOT, 'core/ingest/fixtures/sample.pdf')
  const pdf2 = path.join(ROOT, 'core/ingest/fixtures/sample2.pdf')

  const p1 = await window.evaluate((p) => window.vellum.ingest(p), pdf1)
  const p2 = await window.evaluate((p) => window.vellum.ingest(p), pdf2)
  console.log(`Ingested papers: ${p1.slug}, ${p2.slug}`)

  // Create chat sessions on both papers
  const chat1 = await window.evaluate((slug) => window.vellum.askOpen(slug), p1.slug)
  console.log(`Created chat 1 on ${p1.slug} (ID: ${chat1.session.id}, backend: ${chat1.session.backend})`)

  // Rename chat 1
  await window.evaluate(
    ({ id, title }) => window.vellum.chatRenameSession({ id, title }),
    { id: chat1.session.id, title: 'Attention Deep Dive' }
  )

  // Create a new chat on paper 1 with codex
  const chat2 = await window.evaluate(
    (slug) => window.vellum.askNewChat({ slug, backend: 'codex' }),
    p1.slug
  )
  console.log(`Created chat 2 on ${p1.slug} (ID: ${chat2.session.id}, backend: ${chat2.session.backend})`)
  await window.evaluate(
    ({ id, title }) => window.vellum.chatRenameSession({ id, title }),
    { id: chat2.session.id, title: 'Codex Exploration' }
  )

  // Create chat on paper 2 with claude
  const chat3 = await window.evaluate((slug) => window.vellum.askOpen(slug), p2.slug)
  console.log(`Created chat 3 on ${p2.slug} (ID: ${chat3.session.id}, backend: ${chat3.session.backend})`)
  await window.evaluate(
    ({ id, title }) => window.vellum.chatRenameSession({ id, title }),
    { id: chat3.session.id, title: 'Paper Two Overview' }
  )

  // List sessions via bridge
  const sessions = await window.evaluate(() => window.vellum.chatListSessions())
  assert(sessions.length >= 3, 'Should have at least 3 chat sessions')
  const foundChat1 = sessions.find((s) => s.id === chat1.session.id)
  assert(foundChat1, 'Chat 1 exists in sessions list')
  assert.strictEqual(foundChat1.title, 'Attention Deep Dive')
  assert.strictEqual(foundChat1.paperSlug, p1.slug)
  assert.strictEqual(foundChat1.backend, 'claude')

  const foundChat2 = sessions.find((s) => s.id === chat2.session.id)
  assert(foundChat2, 'Chat 2 exists in sessions list')
  assert.strictEqual(foundChat2.title, 'Codex Exploration')
  assert.strictEqual(foundChat2.backend, 'codex')
  console.log('Bridge queries confirmed sessions across papers and backends.')

  // UI Verification: switch sidebar to Chats
  await window.click('button[role="tab"]:has-text("Chats")')
  await window.waitForTimeout(500)

  // Verify ChatsList rendered in UI
  const chatItems = await window.$$eval('li[role="option"]', (els) => els.map((el) => el.textContent))
  assert(chatItems.some((text) => text.includes('Attention Deep Dive')), 'UI lists Attention Deep Dive')
  assert(chatItems.some((text) => text.includes('Codex Exploration')), 'UI lists Codex Exploration')
  assert(chatItems.some((text) => text.includes('Paper Two Overview')), 'UI lists Paper Two Overview')
  console.log('UI Chats list verified with all titles and backends.')

  // Test search in ChatsList
  await window.fill('input[aria-label="Search chats"]', 'Codex')
  await window.waitForTimeout(300)
  const filteredItems = await window.$$eval('li[role="option"]', (els) => els.map((el) => el.textContent))
  assert.strictEqual(filteredItems.length, 1, 'Search filters to 1 chat')
  assert(filteredItems[0].includes('Codex Exploration'))
  console.log('Chats search filtering verified.')

  // Clear search
  await window.fill('input[aria-label="Search chats"]', '')
  await window.waitForTimeout(300)

  // Reopen chat 1 by clicking on its item
  console.log('Testing session reopening from Chats library...')
  await window.click('li[role="option"]:has-text("Attention Deep Dive")')
  await window.waitForTimeout(500)

  // Confirm that reader/Ask panel is active
  const askTab = await window.$('button[role="tab"][aria-selected="true"]:has-text("Ask")')
  assert(askTab, 'Ask tab should be selected after opening chat')
  console.log('Session reopening into AskPanel verified.')

  // Close instance 1
  await app.close()
  console.log('Instance 1 closed.')

  // Launch instance 2 to verify persistence across restarts
  console.log('2. Launching Electron App (Instance 2) for persistence verification...')
  const app2 = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'out/main/index.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  const window2 = await app2.firstWindow()
  await window2.waitForLoadState('domcontentloaded')

  const sessionsAfterRestart = await window2.evaluate(() => window.vellum.chatListSessions())
  const rChat1 = sessionsAfterRestart.find((s) => s.id === chat1.session.id)
  const rChat2 = sessionsAfterRestart.find((s) => s.id === chat2.session.id)
  assert(rChat1, 'Chat 1 persisted across restart')
  assert.strictEqual(rChat1.title, 'Attention Deep Dive')
  assert.strictEqual(rChat1.backend, 'claude')
  assert(rChat2, 'Chat 2 persisted across restart')
  assert.strictEqual(rChat2.title, 'Codex Exploration')
  assert.strictEqual(rChat2.backend, 'codex')
  console.log('Persistence across restarts verified: Sessions and backends intact.')

  await app2.close()
  console.log('=== [L2-02] LIVE CHATS LIBRARY VERIFICATION SUCCESSFUL ===')
}

runLiveVerification().catch((err) => {
  console.error('LIVE VERIFICATION FAILED:', err)
  process.exit(1)
})
