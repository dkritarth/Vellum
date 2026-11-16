// Verify dotted-arXiv-slug purge through production IPC in isolated state.
// The recorded walkthrough separately covers the visible Trash/purge controls.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const ARXIV_ID = '1706.03762'
const shots = path.join(ROOT, 'test-artifacts', 'purge-live')
fs.mkdirSync(shots, { recursive: true })
const { app, window, dataDir, consoleLines } = await launchIsolatedApp()
try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  const paper = await window.evaluate((id) => window.vellum.ingest(id), ARXIV_ID)
  assert(paper.slug.includes('.'), `Expected a dotted arXiv slug, got ${paper.slug}`)
  const papers = await window.evaluate(() => window.vellum.listPapers({}))
  assert(papers.some((record) => record.slug === paper.slug))
  await window.evaluate((slug) => window.vellum.paperTrash(slug), paper.slug)
  await window.evaluate((slug) => window.vellum.paperPurge(slug), paper.slug)
  const after = await window.evaluate(() => window.vellum.listPapers({ trashed: true }))
  assert(!after.some((record) => record.slug === paper.slug))
  assert(!fs.existsSync(path.join(dataDir, 'papers', paper.slug)), 'Purge removes paper files')
  await window.screenshot({ path: path.join(shots, 'after-purge.png') })
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: real arXiv dotted slug purged from isolated SQLite and filesystem; console clean')
} catch (error) {
  await captureFailureArtifacts('purge-live', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(shots, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(app, dataDir)
}
