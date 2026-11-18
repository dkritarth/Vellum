// Live check: re-adding a paper while no agent is reachable keeps the
// metadata, summary and added date from the first (signed-in Codex) ingest.
// Usage: xvfb-run -a node test/reingest-keeps-metadata-live.mjs /path/to/paper.pdf
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? '')
assert(fs.existsSync(pdf), `Missing PDF: ${pdf}`)
const evidence = path.join(ROOT, 'test-artifacts', 'reingest-keeps-metadata')
fs.mkdirSync(evidence, { recursive: true })
const originalPath = process.env.PATH
const offlineBin = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-offline-'))
for (const adapter of ['codex-acp', 'claude-agent-acp', 'claude-code-acp', 'agy']) {
  fs.writeFileSync(path.join(offlineBin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
}

async function addAndRead(session) {
  const { window } = session
  const button = (name) => window.getByRole('button', { name, exact: true })
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 400_000 })
  const [paper] = await window.evaluate(() => window.vellum.listPapers())
  return window.evaluate((slug) => window.vellum.getPaper(slug), paper.slug)
}

let session = await launchIsolatedApp()
const dataDir = session.dataDir
const consoleLines = []
try {
  const first = await addAndRead(session)
  console.log('first ingest:', { authors: first.authors.length, abstract: Boolean(first.abstract), summary: Boolean(first.summary), addedAt: first.addedAt })
  assert(first.authors.length > 0 && first.summary, 'first ingest needs signed-in agent metadata')
  consoleLines.push(...session.consoleLines)
  await session.app.close()

  process.env.PATH = `${offlineBin}:${originalPath}`
  session = await launchIsolatedApp({ dataDir })
  const second = await addAndRead(session)
  console.log('re-ingest offline:', { authors: second.authors.length, abstract: Boolean(second.abstract), summary: Boolean(second.summary), addedAt: second.addedAt })
  await session.window.getByRole('tab', { name: 'Details', exact: true }).click()
  await session.window.waitForTimeout(500)
  await session.window.screenshot({ path: path.join(evidence, 'details-after-offline-reingest.png') })
  assert.equal(second.title, first.title)
  assert.deepEqual(second.authors, first.authors)
  assert.equal(second.abstract, first.abstract)
  assert.equal(second.summary, first.summary)
  assert.equal(second.addedAt, first.addedAt)
  consoleLines.push(...session.consoleLines)
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: offline re-ingest kept title, authors, abstract, summary and added date; console clean')
} catch (error) {
  await captureFailureArtifacts('reingest-keeps-metadata', { window: session.window, consoleLines: [...consoleLines, ...session.consoleLines] })
  throw error
} finally {
  process.env.PATH = originalPath
  await cleanupIsolatedApp(session.app, dataDir)
  fs.rmSync(offlineBin, { recursive: true, force: true })
}
