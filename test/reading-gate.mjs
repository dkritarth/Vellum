// E2E Verification Harness for [G1] Daily Paper-Reading Workflow Certification
// Runs in live Electron via Playwright under xvfb.
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'node:fs'
import assert from 'node:assert'

import {
  launchIsolatedApp,
  captureFailureArtifacts,
  assertNoConsoleErrors,
  ROOT,
} from './harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appPath = path.join(__dirname, '../out/main/index.cjs')
const sample1Path = path.join(__dirname, '../core/ingest/fixtures/sample.pdf')
const sample2Path = path.join(__dirname, '../core/ingest/fixtures/sample2.pdf')

async function runGateCertification() {
  console.log('=== Starting [G1] Daily Paper-Reading Workflow Live Certification ===\n')

  const first = await launchIsolatedApp({ appPath })
  let app1 = first.app
  let window1 = first.window
  const console1 = first.consoleLines
  const dataDir = first.dataDir

  let app2 = null
  let window2 = null
  const console2 = []
  let passed = false

  try {
    console.log('1. Launching Electron App (Instance 1)...')
    const title = await window1.title()
    console.log(`   Window Title: ${title}`)
    if (title !== 'Vellum') throw new Error(`Unexpected title: ${title}`)

    await window1.waitForSelector('footer:has-text("bridge: pong")', { timeout: 5000 })
    console.log('   Preload IPC Bridge: Verified (pong)')

    console.log('\n2. Ingesting Real PDF Papers via IPC bridge...')
    const p1 = await window1.evaluate(async (filePath) => {
      return window.vellum.ingest(filePath)
    }, sample1Path)
    console.log(`   Ingested Paper 1: slug=${p1.slug}, title="${p1.title}"`)

    const p2 = await window1.evaluate(async (filePath) => {
      return window.vellum.ingest(filePath)
    }, sample2Path)
    console.log(`   Ingested Paper 2: slug=${p2.slug}, title="${p2.title}"`)

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

    const verifyP1 = await window1.evaluate(async (slug) => window.vellum.notesGet(slug), p1.slug)
    if (verifyP1.body.includes('Diffusion')) throw new Error('Paper isolation failed: Paper 2 content leaked into Paper 1')
    console.log('   Isolation Verified: Paper 1 and Paper 2 notes are strictly isolated.')

    console.log('\n4. Testing Highlights CRUD & Anchor Persistence...')
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

    await window1.evaluate(async (id) => window.vellum.highlightsDelete(id), highlight2.id)
    listP1 = await window1.evaluate(async (slug) => window.vellum.highlightsList(slug), p1.slug)
    if (listP1.length !== 1 || listP1[0].id !== highlight1.id) {
      throw new Error('Highlight deletion failed')
    }
    console.log('   Highlight Deletion Verified: Highlight 2 removed, Highlight 1 retained.')

    console.log('\n5. Testing UI Panels and Tab Navigation...')
    const rightPanelTabs = window1.locator('aside[aria-label="Paper panel"] [role="tab"]')
    const tabCount = await rightPanelTabs.count()
    console.log(`   RightPanel Tab Count: ${tabCount}`)
    if (tabCount !== 4) throw new Error(`Expected 4 tabs in RightPanel, found ${tabCount}`)

    await rightPanelTabs.nth(1).click() // Notes
    console.log('   Clicked Notes tab')
    await rightPanelTabs.nth(2).click() // Details
    console.log('   Clicked Details tab')
    await rightPanelTabs.nth(3).click() // Annotations
    console.log('   Clicked Annotations tab')
    await rightPanelTabs.nth(0).click() // Ask
    console.log('   Clicked Ask tab')

    console.log('\n6. Testing Ingest Modal UI...')
    await window1.click('button:has-text("Create")')
    await window1.waitForSelector('[role="dialog"]', { timeout: 3000 })
    console.log('   Ingest Modal Opened successfully.')
    await window1.click('button:has-text("Cancel")')
    console.log('   Ingest Modal Cancelled.')

    console.log('\n7. Closing Electron App (Instance 1)...')
    await app1.close()
    app1 = null
    window1 = null

    console.log('\n8. Launching Electron App (Instance 2) to verify SQLite Persistence across restart...')
    const second = await launchIsolatedApp({ appPath, dataDir })
    app2 = second.app
    window2 = second.window
    console2.push(...second.consoleLines)

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
    app2 = null
    window2 = null

    assertNoConsoleErrors([...console1, ...console2], [])
    console.log('\n=== [G1] DAILY PAPER-READING WORKFLOW CERTIFICATION SUCCESSFUL ===')
    passed = true
  } catch (err) {
    const targetWindow = window2 || window1
    const targetConsole = [...console1, ...console2]
    await captureFailureArtifacts('reading-gate', {
      window: targetWindow,
      consoleLines: targetConsole,
    })
    console.error('\nGATE CERTIFICATION FAILED:', err)
    throw err
  } finally {
    if (app2) { try { await app2.close() } catch {} }
    if (app1) { try { await app1.close() } catch {} }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch (e) {
      console.error('[harness] cleanup failed:', e)
    }
    if (!passed) process.exitCode = 1
  }
}

runGateCertification().catch((err) => {
  console.error('\nGATE CERTIFICATION FAILED:', err)
  process.exit(1)
})
