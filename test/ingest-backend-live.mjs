// Live check for ingest backend fallback: with the Claude and Gemini adapters
// shadowed (exit 127) and signed-in Codex available, adding a real paper must
// still produce agent-extracted metadata and a summary.
// Usage: xvfb-run -a node test/ingest-backend-live.mjs /path/to/paper.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? path.join(ROOT, 'core/ingest/fixtures/sample.pdf'))
assert(fs.existsSync(pdf), `Missing PDF: ${pdf}`)
const evidence = path.join(ROOT, 'test-artifacts', 'ingest-backend')
fs.mkdirSync(evidence, { recursive: true })

const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-no-claude-'))
for (const adapter of ['claude-agent-acp', 'claude-code-acp', 'agy']) {
  fs.writeFileSync(path.join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
}
process.env.PATH = `${bin}:${process.env.PATH}`

const { app, window, dataDir, consoleLines } = await launchIsolatedApp()
const button = (name) => window.getByRole('button', { name, exact: true })
try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 400_000 })
  const [paper] = await window.evaluate(() => window.vellum.listPapers())
  const record = await window.evaluate((slug) => window.vellum.getPaper(slug), paper.slug)
  const summary = {
    title: record.title,
    authors: record.authors?.length ?? 0,
    abstract: Boolean(record.abstract),
    sections: record.sections?.length ?? 0,
    summary: Boolean(record.summary),
  }
  console.log('stored metadata:', summary)
  fs.writeFileSync(path.join(evidence, 'paper.json'), JSON.stringify(record, null, 2))
  await window.getByRole('tab', { name: 'Details', exact: true }).click()
  await window.waitForTimeout(500)
  await window.screenshot({ path: path.join(evidence, 'details.png') })
  assert(summary.authors > 0, 'agent-extracted authors expected via Codex fallback')
  assert(summary.abstract, 'agent-extracted abstract expected')
  assert(summary.summary, 'agent summary expected')
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: ingest fell back to Codex with Claude unavailable; metadata and summary stored; console clean')
} catch (error) {
  await captureFailureArtifacts('ingest-backend', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(app, dataDir)
  fs.rmSync(bin, { recursive: true, force: true })
}
