// Live Electron verification script for [L2-01] Hierarchical collections and Library filtering
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'node:assert'
import fs from 'node:fs'

import {
  launchIsolatedApp,
  captureFailureArtifacts,
  assertNoConsoleErrors,
} from './harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function runLiveVerification() {
  console.log('=== [L2-01] Live Collections Verification Starting ===')

  const first = await launchIsolatedApp()
  let app = first.app
  let window = first.window
  const console1 = first.consoleLines
  const dataDir = first.dataDir
  let app2 = null
  const console2 = []
  let passed = false

  try {
    console.log('1. Launching Electron App (Instance 1)...')
    await window.waitForLoadState('domcontentloaded')

    const consoleLogs = console1
    window.on('console', (msg) => consoleLogs.push(msg.text()))
    // already captured via harness; duplicate harmless

    // Check bridge
    const pong = await window.evaluate(() => window.vellum.ping())
    assert.strictEqual(pong, 'pong')

    // Ingest sample papers
    const pdf1 = path.join(ROOT, 'core/ingest/fixtures/sample.pdf')
    const pdf2 = path.join(ROOT, 'core/ingest/fixtures/sample2.pdf')

    const p1 = await window.evaluate((p) => window.vellum.ingest(p), pdf1)
    const p2 = await window.evaluate((p) => window.vellum.ingest(p), pdf2)
    console.log(`Ingested papers: ${p1.slug}, ${p2.slug}`)

    // Create collections via bridge
    const cs = await window.evaluate(() => window.vellum.collectionsCreate({ name: 'Computer Science' }))
    console.log(`Created root collection: ID ${cs.id} (${cs.name})`)

    const nlp = await window.evaluate((pid) => window.vellum.collectionsCreate({ name: 'NLP', parentId: pid }), cs.id)
    console.log(`Created child collection: ID ${nlp.id} (${nlp.name}) under ${cs.id}`)

    // Assign papers
    await window.evaluate(
      ({ slug, cid }) => window.vellum.collectionsAssign({ paperSlug: slug, collectionId: cid }),
      { slug: p1.slug, cid: nlp.id }
    )
    await window.evaluate(
      ({ slug, cid }) => window.vellum.collectionsAssign({ paperSlug: slug, collectionId: cid }),
      { slug: p2.slug, cid: cs.id }
    )
    console.log('Assigned papers to collections.')

    // Check tree structure
    const tree = await window.evaluate(() => window.vellum.collectionsTree())
    const csNode = tree.find((c) => c.id === cs.id)
    assert(csNode, 'Root collection node exists in tree')
    assert.strictEqual(csNode.name, 'Computer Science')
    assert.strictEqual(csNode.paperCount, 1)
    const nlpNode = csNode.children.find((c) => c.id === nlp.id)
    assert(nlpNode, 'Child collection node exists in tree')
    assert.strictEqual(nlpNode.name, 'NLP')
    assert.strictEqual(nlpNode.paperCount, 1)
    console.log('Tree structure & paper counts verified via bridge.')

    // UI verification
    await window.click('button:has-text("Library")')
    await window.waitForTimeout(500)

    const allCards = await window.$$eval('button[role="listitem"]', (els) => els.length)
    assert(allCards >= 2, 'Expected at least 2 cards in library')
    console.log(`All papers view shows ${allCards} papers.`)

    await window.click('div[role="treeitem"]:has-text("NLP")')
    await window.waitForTimeout(500)

    const bannerText = await window.textContent('[role="status"]')
    assert(bannerText.includes('NLP'), 'Filter banner should display NLP')
    const filteredCards = await window.$$eval('button[role="listitem"]', (els) => els.length)
    assert.strictEqual(filteredCards, 1, 'NLP collection should filter to exactly 1 paper')
    console.log(`Filtered view shows 1 paper with active filter banner: "${bannerText.trim()}"`)

    await window.click('button:has-text("Clear filter")')
    await window.waitForTimeout(500)
    const clearedCards = await window.$$eval('button[role="listitem"]', (els) => els.length)
    assert(clearedCards >= 2, 'Clearing filter restores all papers')
    console.log('Clearing filter restored full library.')

    await window.evaluate(({ id, name }) => window.vellum.collectionsRename({ id, name }), { id: nlp.id, name: 'Natural Language Processing' })
    const updatedTree = await window.evaluate(() => window.vellum.collectionsTree())
    const csUpdated = updatedTree.find((c) => c.id === cs.id)
    const nlpUpdated = csUpdated.children.find((c) => c.id === nlp.id)
    assert.strictEqual(nlpUpdated.name, 'Natural Language Processing')
    console.log('Collection rename verified.')

    await app.close()
    app = null
    window = null
    console.log('Instance 1 closed.')

    console.log('2. Launching Electron App (Instance 2) for persistence verification...')
    const second = await launchIsolatedApp({ dataDir })
    app2 = second.app
    const window2 = second.app ? second.window : null
    // careful naming
    const w2 = second.window
    console2.push(...second.consoleLines)

    const tree2 = await w2.evaluate(() => window.vellum.collectionsTree())
    const csNode2 = tree2.find((c) => c.id === cs.id)
    assert(csNode2, 'Root collection node exists after restart')
    assert.strictEqual(csNode2.name, 'Computer Science')
    const nlpNode2 = csNode2.children.find((c) => c.id === nlp.id)
    assert(nlpNode2, 'Renamed child collection node exists after restart')
    assert.strictEqual(nlpNode2.name, 'Natural Language Processing')
    assert.strictEqual(nlpNode2.paperCount, 1)
    console.log('Persistence across restarts verified: Tree and paper counts intact.')

    await app2.close()
    app2 = null

    assertNoConsoleErrors([...console1, ...console2], [])
    console.log('=== [L2-01] LIVE COLLECTIONS VERIFICATION SUCCESSFUL ===')
    passed = true
  } catch (err) {
    const targetWindow = app ? window : (app2 ? undefined : undefined)
    await captureFailureArtifacts('collections-live', {
      window: window || undefined,
      consoleLines: [...console1, ...console2],
    })
    console.error('LIVE VERIFICATION FAILED:', err)
    throw err
  } finally {
    if (app2) { try { await app2.close() } catch {} }
    if (app) { try { await app.close() } catch {} }
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
    if (!passed) process.exitCode = 1
  }
}

runLiveVerification().catch((err) => {
  console.error('LIVE VERIFICATION FAILED:', err)
  process.exit(1)
})
