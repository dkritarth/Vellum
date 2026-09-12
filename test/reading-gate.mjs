// E2E Verification Harness for [G1] Daily Paper-Reading Workflow Certification
// Runs in live Electron via Playwright under xvfb.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appPath = path.join(__dirname, '../out/main/index.cjs')
const sample1Path = path.join(__dirname, '../core/ingest/fixtures/sample.pdf')
const sample2Path = path.join(__dirname, '../core/ingest/fixtures/sample2.pdf')

async function runGateCertification() {
  console.log('=== Starting [G1] Daily Paper-Reading Workflow Live Certification ===\n')

  // Phase 1: Launch Electron instance 1
  console.log('1. Launching Electron App (Instance 1)...')
  const app1 = await electron.launch({
    args: ['--no-sandbox', appPath],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })

  const window1 = await app1.firstWindow()
  await window1.waitForLoadState('domcontentloaded')

  const title = await window1.title()
  console.log(`   Window Title: ${title}`)
  if (title !== 'Vellum') throw new Error(`Unexpected title: ${title}`)

  await window1.waitForSelector('footer:has-text("bridge: pong")', { timeout: 5000 })
  console.log('   Preload IPC Bridge: Verified (pong)')

  // Ingest two real sample papers for two-paper isolation tests
  console.log('\n2. Ingesting Real PDF Papers via IPC bridge...')
  const p1 = await window1.evaluate(async (filePath) => {
    return window.vellum.ingest(filePath)
  }, sample1Path)
  console.log(`   Ingested Paper 1: slug=${p1.slug}, title="${p1.title}"`)

  const p2 = await window1.evaluate(async (filePath) => {
    return window.vellum.ingest(filePath)
  }, sample2Path)
  console.log(`   Ingested Paper 2: slug=${p2.slug}, title="${p2.title}"`)

  // 3. Test Notes Workflow & Paper Isolation
  console.log('\n3. Testing Notes Workflow & Two-Paper Isolation...')
  const noteP1 = await window1.evaluate(async (slug) => {
    await window.vellum.notesSave({
      slug,
      body: '# Notes for Paper 1\nKey takeaway: Self-attention scales O(N^2).',
    })
    return window.vellum.notesGet(slug)
  }, p1.slug)
  console.log(`   Paper 1 Note Saved: "${noteP1.body.split('\n')[0]}"`)
  if (!noteP1.body.includes('Self-attention')) throw new Error('Paper 1 note save failed')

  const noteP2 = await window1.evaluate(async (slug) => {
    await window.vellum.notesSave({
      slug,
      body: '# Notes for Paper 2\nDiffusion models perform iterative denoising.',
    })
    return window.vellum.notesGet(slug)
  }, p2.slug)
  console.log(`   Paper 2 Note Saved: "${noteP2.body.split('\n')[0]}"`)

  // Verify isolation
  const verifyP1 = await window1.evaluate(async (slug) => window.vellum.notesGet(slug), p1.slug)
  if (verifyP1.body.includes('Diffusion')) throw new Error('Paper isolation failed: Paper 2 content leaked into Paper 1')
  console.log('   Isolation Verified: Paper 1 and Paper 2 notes are strictly isolated.')

  // 4. Test Highlights CRUD in live Electron
  console.log('\n4. Testing Highlights CRUD & Anchor Persistence...')
  // Clear any pre-existing highlights from previous test runs
  const existing = await window1.evaluate(async (slug) => window.vellum.highlightsList(slug), p1.slug)
  for (const h of existing) {
    await window1.evaluate(async (id) => window.vellum.highlightsDelete(id), h.id)
  }
  const highlight1 = await window1.evaluate(async (slug) => {
    return window.vellum.highlightsCreate({
      slug,
      page: 1,
      color: 'yellow',
      quote: 'Attention is all you need',
      anchor: JSON.stringify({ start: 10, end: 35 }),
    })
  }, p1.slug)
  console.log(`   Highlight 1 Created (ID: ${highlight1.id}, color: ${highlight1.color})`)

  const highlight2 = await window1.evaluate(async (slug) => {
    return window.vellum.highlightsCreate({
      slug,
      page: 1,
      color: 'green',
      quote: 'Multi-head attention allows the model to jointly attend to information',
      anchor: JSON.stringify({ start: 100, end: 170 }),
    })
  }, p1.slug)
  console.log(`   Highlight 2 Created (ID: ${highlight2.id}, color: ${highlight2.color})`)

  let listP1 = await window1.evaluate(async (slug) => window.vellum.highlightsList(slug), p1.slug)
  if (listP1.length !== 2) throw new Error(`Expected 2 highlights, found ${listP1.length}`)
  console.log(`   Highlights List Verified: Found ${listP1.length} highlights for ${p1.slug}.`)

  // Delete highlight 2
  await window1.evaluate(async (id) => window.vellum.highlightsDelete(id), highlight2.id)
  listP1 = await window1.evaluate(async (slug) => window.vellum.highlightsList(slug), p1.slug)
  if (listP1.length !== 1 || listP1[0].id !== highlight1.id) {
    throw new Error('Highlight deletion failed')
  }
  console.log('   Highlight Deletion Verified: Highlight 2 removed, Highlight 1 retained.')

  // 5. Test UI Navigation and RightPanel Tabs
  console.log('\n5. Testing UI Panels and Tab Navigation...')
  const rightPanelTabs = window1.locator('aside[aria-label="Paper panel"] [role="tab"]')
  const tabCount = await rightPanelTabs.count()
  console.log(`   RightPanel Tab Count: ${tabCount}`)
  if (tabCount !== 4) throw new Error(`Expected 4 tabs in RightPanel, found ${tabCount}`)

  // Click each tab
  await rightPanelTabs.nth(1).click() // Notes
  console.log('   Clicked Notes tab')
  await rightPanelTabs.nth(2).click() // Details
  console.log('   Clicked Details tab')
  await rightPanelTabs.nth(3).click() // Annotations
  console.log('   Clicked Annotations tab')
  await rightPanelTabs.nth(0).click() // Ask
  console.log('   Clicked Ask tab')

  // 6. Test Ingest Modal UI
  console.log('\n6. Testing Ingest Modal Trigger...')
  await window1.click('button:has-text("Create")')
  await window1.waitForSelector('[role="dialog"]', { timeout: 3000 })
  console.log('   Ingest Modal Opened successfully.')
  await window1.click('button:has-text("Cancel")')
  console.log('   Ingest Modal Cancelled.')

  // Close Instance 1
  console.log('\n7. Closing Electron App (Instance 1)...')
  await app1.close()

  // 8. Launch Instance 2 to test SQLite Restart Persistence
  console.log('\n8. Launching Electron App (Instance 2) to verify SQLite Persistence across restart...')
  const app2 = await electron.launch({
    args: ['--no-sandbox', appPath],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })

  const window2 = await app2.firstWindow()
  await window2.waitForLoadState('domcontentloaded')

  const persistedNote = await window2.evaluate(async (slug) => window.vellum.notesGet(slug), p1.slug)
  if (!persistedNote || !persistedNote.body.includes('Self-attention scales O(N^2)')) {
    throw new Error('Restart persistence failed for notes')
  }
  console.log(`   Restart Note Persistence Verified: "${persistedNote.body.split('\n')[0]}"`)

  const persistedHighlights = await window2.evaluate(async (slug) => window.vellum.highlightsList(slug), p1.slug)
  if (persistedHighlights.length !== 1 || persistedHighlights[0].quote !== 'Attention is all you need') {
    throw new Error('Restart persistence failed for highlights')
  }
  console.log(`   Restart Highlight Persistence Verified: "${persistedHighlights[0].quote}"`)

  await app2.close()
  console.log('\n=== [G1] DAILY PAPER-READING WORKFLOW CERTIFICATION SUCCESSFUL ===')
}

runGateCertification().catch((err) => {
  console.error('\nGATE CERTIFICATION FAILED:', err)
  process.exit(1)
})
