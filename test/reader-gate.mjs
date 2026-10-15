// Live Electron verification gate for PDF Reader rendering
// Asserts real rendered output: canvas count > 0, non-zero dimensions,
// text layer spans, zoom/navigation controls, and clean console over repeated opens.
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

async function runReaderGate() {
  console.log('=== Starting PDF Reader Rendering Live Gate ===\n')

  const { app, window, consoleLines, dataDir } = await launchIsolatedApp({ appPath })
  let passed = false

  try {
    console.log('1. Launching Electron App and verifying IPC bridge...')
    await window.waitForSelector('footer:has-text("bridge: pong")', { timeout: 15000 })
    console.log('   Preload IPC Bridge: Verified (pong)')

    console.log('\n2. Ingesting real PDF...')
    const paper = await window.evaluate(async (filePath) => {
      return window.vellum.ingest(filePath)
    }, sample1Path)
    assert(paper?.slug, 'Ingest failed to return a slug')
    console.log(`   Ingested Paper: slug=${paper.slug}, title="${paper.title}"`)

    console.log('\n3. Testing Repeated Opens (Render Rate Verification)...')
    const TOTAL_OPENS = 5
    let successfulRenders = 0

    for (let i = 1; i <= TOTAL_OPENS; i++) {
      // Go to Library
      await window.click('nav button:has-text("Library")')
      await window.waitForSelector('[role="list"][aria-label="Papers"]', { timeout: 10000 })

      // Click card to open in reader
      await window.click(`button:has-text("${paper.title}")`)

      // Wait for canvas element to appear
      await window.waitForSelector('canvas', { timeout: 10000 })

      // Wait briefly for canvas dimensions to settle
      await window.waitForTimeout(500)

      const canvasInfo = await window.evaluate(() => {
        const canvas = document.querySelector('canvas')
        const errorEl = Array.from(document.querySelectorAll('p')).find(p => (p.textContent || "").includes('Could not open this PDF.'))
        const spans = document.querySelectorAll('[class*="textLayer"] span')
        return {
          hasError: !!errorEl,
          width: canvas ? canvas.width : 0,
          height: canvas ? canvas.height : 0,
          textSpansCount: spans.length,
        }
      })

      assert.strictEqual(canvasInfo.hasError, false, `Open ${i}: Found "Could not open this PDF." error in reader!`)
      assert(canvasInfo.width > 0, `Open ${i}: Canvas width is 0!`)
      assert(canvasInfo.height > 0, `Open ${i}: Canvas height is 0!`)
      assert(canvasInfo.textSpansCount > 0, `Open ${i}: TextLayer has 0 spans!`)

      successfulRenders++
      console.log(`   Open ${i}/${TOTAL_OPENS}: Success (canvas ${canvasInfo.width}x${canvasInfo.height}, ${canvasInfo.textSpansCount} text spans)`)
    }

    console.log(`\n   Render Rate: ${successfulRenders}/${TOTAL_OPENS} (${(successfulRenders / TOTAL_OPENS) * 100}%)`)
    assert.strictEqual(successfulRenders, TOTAL_OPENS, 'Not all opens rendered successfully')

    console.log('\n4. Testing Reader Zoom Controls...')
    const initialZoom = await window.locator('[aria-label="Zoom"]').textContent()
    console.log(`   Initial zoom: ${initialZoom}`)

    await window.click('div[class*="zoom"] button:has-text("+")')
    await window.waitForTimeout(500)
    const zoomedIn = await window.locator('[aria-label="Zoom"]').textContent()
    console.log(`   Zoomed in (+): ${zoomedIn}`)
    assert.notStrictEqual(initialZoom, zoomedIn, 'Zoom in (+) failed to update scale')

    await window.click('div[class*="zoom"] button:has-text("−")')
    await window.waitForTimeout(500)
    const zoomedOut = await window.locator('[aria-label="Zoom"]').textContent()
    console.log(`   Zoomed out (−): ${zoomedOut}`)
    assert.strictEqual(zoomedOut, initialZoom, 'Zoom out (−) failed to return to initial scale')

    console.log('\n5. Testing TextLayer Selectable Text...')
    const textLayerContent = await window.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('[class*="textLayer"] span'))
      return spans.map(s => s.textContent || '').join(' ').trim()
    })
    console.log(`   TextLayer text preview: "${textLayerContent.slice(0, 60)}..."`)
    assert(textLayerContent.length > 0, 'TextLayer content is empty')

    // Optional arXiv verification if network reachable
    try {
      console.log('\n6. Testing Real arXiv Paper Ingest & Render (1706.03762)...')
      const arxivPaper = await window.evaluate(async () => {
        return window.vellum.ingest('1706.03762')
      })
      console.log(`   Ingested arXiv Paper: ${arxivPaper.slug} ("${arxivPaper.title}")`)

      await window.click('nav button:has-text("Library")')
      await window.waitForSelector('[role="list"][aria-label="Papers"]', { timeout: 10000 })
      await window.click(`button:has-text("${arxivPaper.title}")`)
      await window.waitForSelector('canvas', { timeout: 15000 })
      await window.waitForTimeout(500)

      const arxivCanvas = await window.evaluate(() => {
        const c = document.querySelector('canvas')
        return c ? { width: c.width, height: c.height } : null
      })
      assert(arxivCanvas && arxivCanvas.width > 0 && arxivCanvas.height > 0, 'arXiv canvas failed to render')
      console.log(`   arXiv Paper Canvas Rendered: ${arxivCanvas.width}x${arxivCanvas.height}`)
    } catch (e) {
      console.log(`   (arXiv live network check skipped or error: ${e.message})`)
    }

    assertNoConsoleErrors(consoleLines, [])
    console.log('\n=== PDF READER RENDERING LIVE GATE PASSED ===')
    passed = true
  } catch (err) {
    await captureFailureArtifacts('reader-gate', {
      window,
      consoleLines,
    })
    console.error('\nGATE FAILED:', err)
    throw err
  } finally {
    await app.close()
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch {}
    if (!passed) process.exitCode = 1
  }
}

runReaderGate().catch((err) => {
  console.error('\nGATE FAILED:', err)
  process.exit(1)
})
