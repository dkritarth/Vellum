// Live check for pasted link forms: an arXiv DOI URL and an arXiv abs URL
// with a query string both add the same arXiv paper through Add Paper, and a
// tracking-parameter DOI link resolves through Crossref. Needs network.
// Usage: xvfb-run -a node test/ingest-links-live.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const evidence = path.join(ROOT, 'test-artifacts', 'ingest-links')
fs.mkdirSync(evidence, { recursive: true })
const { app, window, dataDir, consoleLines } = await launchIsolatedApp()
const button = (name) => window.getByRole('button', { name, exact: true })

async function addPaper(input) {
  await button('Create').click()
  await window.getByLabel('Paper identifier or URL').fill(input)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 400_000 })
  return window.evaluate(() => window.vellum.listPapers())
}

try {
  await window.getByText('bridge: pong', { exact: true }).waitFor()
  let papers = await addPaper('https://doi.org/10.48550/arXiv.1706.03762')
  assert.deepEqual(papers.map((paper) => paper.slug), ['arxiv-1706.03762'])
  assert.match(papers[0].title, /Attention Is All You Need/)
  papers = await addPaper('https://arxiv.org/abs/1706.03762?context=cs.LG#abstract')
  assert.deepEqual(papers.map((paper) => paper.slug), ['arxiv-1706.03762'], 'same paper, no duplicate row')
  await window.screenshot({ path: path.join(evidence, 'arxiv-links.png') })
  assertNoConsoleErrors(consoleLines)
  console.log('PASS: arXiv DOI URL and arXiv abs URL with query/fragment add one arXiv paper; console clean')
} catch (error) {
  await captureFailureArtifacts('ingest-links', { window, consoleLines })
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(app, dataDir)
}
