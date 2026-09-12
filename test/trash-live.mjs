// Live Playwright test for [L2-04] Recoverable Trash and Permanent Purge
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import assert from 'node:assert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function runLiveVerification() {
  console.log('=== [L2-04] Live Trash & Purge Verification Starting ===')

  // Step 1: Launch Electron Instance 1
  console.log('1. Launching Electron App...')
  let app = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'out/main/index.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })

  let window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1000)

  // Step 2: Ingest two real papers
  console.log('2. Ingesting test papers...')
  const pdf1 = path.join(ROOT, 'core/ingest/fixtures/sample.pdf')
  const pdf2 = path.join(ROOT, 'core/ingest/fixtures/sample2.pdf')

  const p1 = await window.evaluate((p) => window.vellum.ingest(p), pdf1)
  const p2 = await window.evaluate((p) => window.vellum.ingest(p), pdf2)
  console.log(`Ingested: "${p1.title}" (${p1.slug}) and "${p2.title}" (${p2.slug})`)

  // Step 3: Switch to Library view and verify both papers
  console.log('3. Navigating to Library...')
  const libNavBtn = await window.waitForSelector('button:has-text("Library")')
  await libNavBtn.click()
  await window.waitForTimeout(500)

  await window.getByText(p1.title, { exact: true }).waitFor()
  await window.getByText(p2.title, { exact: true }).waitFor()
  console.log('✓ Both papers visible in Library')

  // Step 4: Move paper 1 to trash
  console.log('4. Moving target paper to Trash...')
  const trashBtn = await window.waitForSelector(`button[aria-label="Move ${p1.title} to trash"]`)
  await trashBtn.click()
  await window.waitForTimeout(500)

  const p1InLib = await window.getByText(p1.title, { exact: true }).count()
  assert.strictEqual(p1InLib, 0, 'Paper 1 should be hidden from Library')
  await window.getByText(p2.title, { exact: true }).waitFor()
  console.log('✓ Paper 1 hidden from Library; Paper 2 remains')

  // Step 5: Open Trash view and verify paper 1 is listed
  console.log('5. Verifying Trash view...')
  const trashNavBtn = await window.waitForSelector('button:has-text("Trash")')
  await trashNavBtn.click()
  await window.waitForTimeout(500)

  await window.waitForSelector('div[aria-label="Trash view"]')
  await window.getByText(p1.title, { exact: true }).waitFor()
  console.log('✓ Paper 1 present in Trash view')

  // Step 6: Restart Electron to verify persistence of trashed state
  console.log('6. Restarting Electron to test persistence across restarts...')
  await app.close()

  app = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'out/main/index.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1000)

  // Verify Paper 1 still hidden in Library after restart
  const libNavBtn2 = await window.waitForSelector('button:has-text("Library")')
  await libNavBtn2.click()
  await window.waitForTimeout(500)

  assert.strictEqual(await window.getByText(p1.title, { exact: true }).count(), 0, 'Paper 1 still hidden from Library after restart')
  await window.getByText(p2.title, { exact: true }).waitFor()
  console.log('✓ Trashed state persisted across restart (Library still excludes it)')

  // Verify Paper 1 still present in Trash view after restart
  const trashNavBtn2 = await window.waitForSelector('button:has-text("Trash")')
  await trashNavBtn2.click()
  await window.waitForTimeout(500)

  await window.getByText(p1.title, { exact: true }).waitFor()
  console.log('✓ Paper 1 still present in Trash view after restart')

  // Step 7: Test Cancel Purge
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

  // Step 8: Test Restore
  console.log('8. Testing Restore...')
  const restoreBtn = await window.waitForSelector(`button[aria-label="Restore ${p1.title}"]`)
  await restoreBtn.click()
  await window.waitForTimeout(500)

  // Navigate back to Library and verify Paper 1 is back
  const backBtn = await window.waitForSelector('button:has-text("Back to Library")')
  await backBtn.click()
  await window.waitForTimeout(500)

  await window.getByText(p1.title, { exact: true }).waitFor()
  await window.getByText(p2.title, { exact: true }).waitFor()
  console.log('✓ Paper 1 successfully restored to Library')

  // Step 9: Re-trash and confirm permanent purge
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

  // Paper 1 should no longer be in Trash
  assert.strictEqual(await window.getByText(p1.title, { exact: true }).count(), 0, 'Paper 1 purged from Trash view')
  console.log('✓ Paper 1 purged from Trash view')

  // Verify on disk that paper directory is gone
  const paper1Dir = path.join(ROOT, 'data/papers', p1.slug)
  assert.strictEqual(fs.existsSync(paper1Dir), false, 'Paper 1 directory must be deleted from disk')
  console.log('✓ Paper 1 files completely purged from disk')

  // Verify paper 2 remains untouched in DB and on disk
  const paper2Dir = path.join(ROOT, 'data/papers', p2.slug)
  assert.strictEqual(fs.existsSync(paper2Dir), true, 'Paper 2 directory must still exist')
  const paper2InDb = await window.evaluate((slug) => window.vellum.getPaper(slug), p2.slug)
  assert.ok(paper2InDb, 'Paper 2 must still exist in DB')
  console.log('✓ Paper 2 untouched and verified')

  await app.close()
  console.log('\n🎉 ALL LIVE TRASH & PURGE CHECKS PASSED!')
}

runLiveVerification().catch((err) => {
  console.error('❌ LIVE TEST FAILED:', err)
  process.exit(1)
})
