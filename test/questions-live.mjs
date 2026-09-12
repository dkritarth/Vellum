// Live Electron verification script for [L2-03] Paper-specific suggested questions
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'node:assert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function runLiveVerification() {
  console.log('=== [L2-03] Live Suggested Questions Verification Starting ===')

  // 1. Launch instance 1
  console.log('1. Launching Electron App (Instance 1)...')
  const app = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'out/main/index.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Ingest sample papers
  const pdf1 = path.join(ROOT, 'core/ingest/fixtures/sample.pdf')
  const pdf2 = path.join(ROOT, 'core/ingest/fixtures/sample2.pdf')

  const p1 = await window.evaluate((p) => window.vellum.ingest(p), pdf1)
  const p2 = await window.evaluate((p) => window.vellum.ingest(p), pdf2)
  console.log(`Ingested papers: ${p1.slug} and ${p2.slug}`)

  // Generate suggested questions for paper 1
  const q1 = await window.evaluate((slug) => window.vellum.questionsGet(slug, 'claude'), p1.slug)
  console.log(`Paper 1 suggested questions (${q1.length}):`)
  for (const q of q1) {
    console.log(`  [${q.category}] ${q.question}`)
  }
  assert(q1.length >= 3 && q1.length <= 5, 'Should generate 3 to 5 questions')
  assert(q1.some((q) => q.category === 'methodology'), 'Has methodology question')
  assert(q1.some((q) => q.category === 'results'), 'Has results question')
  assert(q1.some((q) => q.category === 'limitations'), 'Has limitations question')

  // Generate suggested questions for paper 2
  const q2 = await window.evaluate((slug) => window.vellum.questionsGet(slug, 'claude'), p2.slug)
  console.log(`Paper 2 suggested questions (${q2.length}):`)
  for (const q of q2) {
    console.log(`  [${q.category}] ${q.question}`)
  }
  assert(q2.length >= 3 && q2.length <= 5, 'Should generate 3 to 5 questions for paper 2')

  // UI Verification: open paper 1 in Reader and check AskPanel
  console.log('Testing UI rendering in AskPanel...')
  await window.evaluate((slug) => window.vellum.askOpen(slug), p1.slug)
  await window.click('button[role="tab"]:has-text("Chats")')
  await window.waitForTimeout(500)
  const chatItem = await window.waitForSelector('li[role="option"]')
  await chatItem.click()
  await window.waitForTimeout(600)

  // Check that suggested questions are visible
  await window.waitForSelector('div[aria-label="Suggested questions"]')
  const chipTexts = await window.$$eval('button[class*="questionChip"]', (els) =>
    els.map((el) => el.textContent),
  )
  assert(chipTexts.length >= 3, 'Suggested question chips rendered in AskPanel UI')
  console.log(`UI rendered ${chipTexts.length} question chips.`)

  // Test regenerating questions
  console.log('Testing question regeneration...')
  const refreshed = await window.evaluate(
    (slug) => window.vellum.questionsRegenerate(slug, 'claude'),
    p1.slug,
  )
  assert(refreshed.length >= 3, 'Regenerated questions returned')
  console.log('Regeneration verified.')

  // Close instance 1
  await app.close()
  console.log('Instance 1 closed.')

  // Launch instance 2 to verify persistence across restarts
  console.log('2. Launching Electron App (Instance 2) for cache persistence verification...')
  const app2 = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'out/main/index.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  const window2 = await app2.firstWindow()
  await window2.waitForLoadState('domcontentloaded')

  const cachedQuestions = await window2.evaluate(
    (slug) => window.vellum.questionsGet(slug, 'claude'),
    p1.slug,
  )
  assert.strictEqual(cachedQuestions.length, refreshed.length, 'Questions loaded directly from SQLite cache')
  assert.strictEqual(cachedQuestions[0].question, refreshed[0].question, 'Cached question text matches')
  console.log('Cache persistence across restarts verified.')

  await app2.close()
  console.log('=== [L2-03] LIVE SUGGESTED QUESTIONS VERIFICATION SUCCESSFUL ===')
}

runLiveVerification().catch((err) => {
  console.error('LIVE VERIFICATION FAILED:', err)
  process.exit(1)
})
