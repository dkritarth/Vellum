// Live Playwright test for [L2-04] Recoverable Trash and Permanent Purge
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import assert from 'node:assert'

import {
  launchIsolatedApp,
  captureFailureArtifacts,
  assertNoConsoleErrors,
} from './harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function runLiveVerification() {
  console.log('=== [L2-04] Live Trash & Purge Verification Starting ===')

  const first = await launchIsolatedApp()
  let app = first.app
  let window = first.window
  const console1 = first.consoleLines
  const dataDir = first.dataDir
  const console2 = []
  let passed = false

  try {
    console.log('1. Launching Electron App...')
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    console.log('2. Ingesting test papers...')
    const pdf1 = path.join(ROOT, 'core/ingest/fixtures/sample.pdf')
    const pdf2 = path.join(ROOT, 'core/ingest/fixtures/sample2.pdf')

    const p1 = await window.evaluate((p) => window.vellum.ingest(p), pdf1)
    const p2 = await window.evaluate((p) => window.vellum.ingest(p), pdf2)
    console.log(`Ingested: "${p1.title}" (${p1.slug}) and "${p2.title}" (${p2.slug})`)

    console.log('3. Navigating to Library...')
    const libNavBtn = await window.waitForSelector('button:has-text("Library")')
    await libNavBtn.click()
    await window.waitForTimeout(500)

    await window.getByText(p1.title, { exact: true }).waitFor()
    await window.getByText(p2.title, { exact: true }).waitFor()
    console.log('✓ Both papers visible in Library')

    console.log('4. Moving target paper to Trash...')
    const trashBtn = await window.waitForSelector(`button[aria-label="Move ${p1.title} to trash"]`)
    await trashBtn.click()
    await window.waitForTimeout(500)

    const p1InLib = await window.getByText(p1.title, { exact: true }).count()
    assert.strictEqual(p1InLib, 0, 'Paper 1 should be hidden from Library')
    await window.getByText(p2.title, { exact: true }).waitFor()
    console.log('✓ Paper 1 hidden from Library; Paper 2 remains')

    console.log('5. Verifying Trash view...')
    const trashNavBtn = await window.waitForSelector('button:has-text("Trash")')
    await trashNavBtn.click()
    await window.waitForTimeout(500)

    await window.waitForSelector('div[aria-label="Trash view"]')
    await window.getByText(p1.title, { exact: true }).waitFor()
    console.log('✓ Paper 1 present in Trash view')

    console.log('6. Restarting Electron to test persistence across restarts...')
    await app.close()
    app = null
    window = null

    const second = await launchIsolatedApp({ dataDir })
    app = second.app
    window = second.window
    console2.push(...second.consoleLines)
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    const libNavBtn2 = await window.waitForSelector('button:has-text("Library")')
    await libNavBtn2.click()
    await window.waitForTimeout(500)

    assert.strictEqual(await window.getByText(p1.title, { exact: true }).count(), 0, 'Paper 1 still hidden from Library after restart')
    await window.getByText(p2.title, { exact: true }).waitFor()
    console.log('✓ Trashed state persisted across restart (Library still excludes it)')

    const trashNavBtn2 = await window.waitForSelector('button:has-text("Trash")')
    await trashNavBtn2.click()
    await window.waitForTimeout(500)

    await window.getByText(p1.title, { exact: true }).waitFor()
    console.log('✓ Paper 1 still present in Trash view after restart')

    console.log('7. Testing purge cancellation...')
    const purgeBtn = await window.waitForSelector(`button[aria-label="Delete ${p1.title} permanently"]`)
    await purgeBtn.click()
    await window.waitForTimeout(300)

    await window.waitForSelector('role=dialog')
    const cancelBtn = await window.waitForSelector('button[aria-label="Cancel purge"]')
    await cancelBtn.click()
    await window.waitForTimeout(300)

    assert.strictEqual(await window.$('role=dialog'), null, 'Purge modal should close')
    await window.getByText(p1.title, { exact: true }).waitFor()
    console.log('✓ Cancel purge kept paper in Trash without deleting')

    console.log('8. Testing Restore...')
    const restoreBtn = await window.waitForSelector(`button[aria-label="Restore ${p1.title}"]`)
    await restoreBtn.click()
    await window.waitForTimeout(500)

    const backBtn = await window.waitForSelector('button:has-text("Back to Library")')
    await backBtn.click()
    await window.waitForTimeout(500)

    await window.getByText(p1.title, { exact: true }).waitFor()
    await window.getByText(p2.title, { exact: true }).waitFor()
    console.log('✓ Paper 1 successfully restored to Library')

    console.log('9. Re-trashing and confirming permanent purge...')
    const trashBtn2 = await window.waitForSelector(`button[aria-label="Move ${p1.title} to trash"]`)
    await trashBtn2.click()
    await window.waitForTimeout(500)

    const trashNavBtn3 = await window.waitForSelector('button:has-text("Trash")')
    await trashNavBtn3.click()
    await window.waitForTimeout(500)

    const purgeBtn2 = await window.waitForSelector(`button[aria-label="Delete ${p1.title} permanently"]`)
    await purgeBtn2.click()
    await window.waitForTimeout(300)

    const confirmPurgeBtn = await window.waitForSelector('button[aria-label="Confirm purge"]')
    await confirmPurgeBtn.click()
    await window.waitForTimeout(600)

    assert.strictEqual(await window.getByText(p1.title, { exact: true }).count(), 0, 'Paper 1 purged from Trash view')
    console.log('✓ Paper 1 purged from Trash view')

    const paper1Dir = path.join(dataDir, 'papers', p1.slug)
    assert.strictEqual(fs.existsSync(paper1Dir), false, 'Paper 1 directory must be deleted from disk')
    console.log('✓ Paper 1 files completely purged from disk')

    const paper2Dir = path.join(dataDir, 'papers', p2.slug)
    assert.strictEqual(fs.existsSync(paper2Dir), true, 'Paper 2 directory must still exist')
    const paper2InDb = await window.evaluate((slug) => window.vellum.getPaper(slug), p2.slug)
    assert.ok(paper2InDb, 'Paper 2 must still exist in DB')
    console.log('✓ Paper 2 untouched and verified')

    await app.close()
    app = null
    window = null

    assertNoConsoleErrors([...console1, ...console2], [])
    console.log('\n🎉 ALL LIVE TRASH & PURGE CHECKS PASSED!')
    passed = true
  } catch (err) {
    await captureFailureArtifacts('trash-live', {
      window: window || undefined,
      consoleLines: [...console1, ...console2],
    })
    console.error('❌ LIVE TEST FAILED:', err)
    throw err
  } finally {
    if (app) { try { await app.close() } catch {} }
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
    if (!passed) process.exitCode = 1
  }
}

runLiveVerification().catch((err) => {
  console.error('❌ LIVE TEST FAILED:', err)
  process.exit(1)
})
