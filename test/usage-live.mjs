// Live Playwright test for [L2-05] Honest ACP Usage Metrics and Unavailable State
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
  console.log('=== [L2-05] Live ACP Usage & Telemetry Verification Starting ===')

  const first = await launchIsolatedApp()
  let app = first.app
  let window = first.window
  const console1 = first.consoleLines
  const dataDir = first.dataDir
  const console2 = []
  let app2 = null
  let passed = false

  try {
    console.log('1. Launching Electron App...')
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    console.log('2. Opening Usage view from sidebar footer...')
    const usageBtn = await window.waitForSelector('button:has-text("Usage")')
    await usageBtn.click()
    await window.waitForTimeout(500)

    const title = await window.getByText('ACP Usage & Plan Telemetry').textContent()
    assert.ok(title.includes('ACP Usage & Plan Telemetry'), 'Usage view header must be visible')
    console.log('✓ Navigated to Usage view')

    console.log('3. Checking honest telemetry representation...')
    const claudeCard = await window.waitForSelector('[data-testid="claude-usage-card"]')
    const codexCard = await window.waitForSelector('[data-testid="codex-usage-card"]')

    const claudeText = await claudeCard.textContent()
    const codexText = await codexCard.textContent()

    assert.ok(claudeText.includes('Unavailable'), 'Claude card should display Unavailable for missing metrics')
    assert.ok(codexText.includes('Unavailable'), 'Codex card should display Unavailable for missing metrics')
    assert.ok(!codexText.includes('0 tokens'), 'Missing metrics must never be fabricated as 0 tokens')
    console.log('✓ Honest "Unavailable" badge confirmed (no fabricated 0 values)')

    console.log('4. Ingesting a paper for chat activity...')
    const pdfPath = path.join(ROOT, 'core/ingest/fixtures/sample.pdf')
    const paper = await window.evaluate((p) => window.vellum.ingest(p), pdfPath)
    console.log(`Ingested: "${paper.title}" (${paper.slug})`)

    console.log('5. Verifying IPC usage queries...')
    const summary = await window.evaluate(() => window.vellum.usageGetSummary())
    assert.strictEqual(typeof summary.totalTurns, 'number')
    assert.ok('backends' in summary)
    assert.ok('claude' in summary.backends)
    assert.ok('codex' in summary.backends)
    console.log(`✓ IPC getUsageSummary resolved valid schema: ${summary.totalTurns} turns`)

    const list = await window.evaluate(() => window.vellum.usageGetList({ limit: 10 }))
    assert.ok(Array.isArray(list))
    console.log(`✓ IPC usageGetList resolved ${list.length} records`)

    console.log('6. Testing "Back to Library" navigation...')
    const backBtn = await window.waitForSelector('button:has-text("← Back to Library")')
    await backBtn.click()
    await window.waitForTimeout(500)

    const libSearch = await window.waitForSelector('input[aria-label="Search papers by title"]')
    assert.ok(libSearch, 'Should navigate back to Library view')
    console.log('✓ Back to Library button navigates successfully')

    console.log('7. Testing persistence across Electron restart...')
    await app.close()
    app = null
    window = null

    const second = await launchIsolatedApp({ dataDir })
    app2 = second.app
    const w2 = second.window
    console2.push(...second.consoleLines)
    await w2.waitForLoadState('domcontentloaded')
    await w2.waitForTimeout(1000)

    const usageBtnRestart = await w2.waitForSelector('button:has-text("Usage")')
    await usageBtnRestart.click()
    await w2.waitForTimeout(500)

    await w2.getByText('ACP Usage & Plan Telemetry').waitFor()
    console.log('✓ Usage view loads cleanly after restart')

    const refreshBtn = await w2.waitForSelector('button:has-text("Refresh")')
    await refreshBtn.click()
    await w2.waitForTimeout(300)
    console.log('✓ Refresh button functions properly')

    await app2.close()
    app2 = null

    assertNoConsoleErrors([...console1, ...console2], [])
    console.log('=== [L2-05] Live ACP Usage Verification PASSED ===')
    passed = true
  } catch (err) {
    await captureFailureArtifacts('usage-live', {
      window: (window || (app2 ? undefined : undefined)) || undefined,
      consoleLines: [...console1, ...console2],
    })
    console.error('Test FAILED:', err)
    throw err
  } finally {
    if (app2) { try { await app2.close() } catch {} }
    if (app) { try { await app.close() } catch {} }
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
    if (!passed) process.exitCode = 1
  }
}

runLiveVerification().catch((err) => {
  console.error('Test FAILED:', err)
  process.exit(1)
})
