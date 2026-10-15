// G0 core-journey live certification probe.
// Isolated cwd => isolated data/. Real arXiv ingest + signed-in Codex Ask + grounding check.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.join(__dirname, '../out/main/index.cjs')
const ARXIV_ID = '1706.03762' // "Attention Is All You Need"

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-g0-'))
const shots = path.join(__dirname, '../test-artifacts/g0-core-journey')
fs.mkdirSync(shots, { recursive: true })

// G0_DATA_CWD=isolated runs the app from a temp cwd (true isolation).
// Default runs from the repo root, because better-sqlite3 currently cannot
// load from a foreign cwd (see issue: "[S0-BUG] better-sqlite3 native binding
// fails to load whenever Electron cwd differs from repo root").
const isolated = process.env.G0_DATA_CWD === 'isolated'
const dataRoot = isolated ? work : path.join(__dirname, '..')

const consoleLog = []
function tap(w) {
  w.on('console', (m) => consoleLog.push(`[${m.type()}] ${m.text()}`))
  w.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`))
}

async function launch() {
  const app = await electron.launch({
    args: ['--no-sandbox', APP],
    cwd: isolated ? work : undefined,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  const w = await app.firstWindow()
  await w.waitForLoadState('domcontentloaded')
  tap(w)
  await w.waitForSelector('footer:has-text("bridge: pong")', { timeout: 30000 })
  return { app, w }
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- Instance 1 ----------
let { app, w } = await launch()
check('app boots, preload bridge alive', true)

// 1. Ingest a REAL born-digital arXiv paper by ID.
console.log(`\nIngesting real arXiv ${ARXIV_ID} ...`)
const t0 = Date.now()
const ing = await w.evaluate((id) => window.vellum.ingest(id), ARXIV_ID)
console.log(`  -> slug=${ing.slug} title="${ing.title}" (${Date.now() - t0}ms)`)
check('real arXiv paper ingested', !!ing.slug, `slug=${ing.slug}`)

// 2. Ground truth: read the extracted markdown the agent will actually read.
const mdPath = path.join(dataRoot, 'data', 'papers', ing.slug, 'paper.md')
const pdfPath = path.join(dataRoot, 'data', 'papers', ing.slug, 'paper.pdf')
check('paper.pdf written to disk', fs.existsSync(pdfPath), `${fs.existsSync(pdfPath) ? fs.statSync(pdfPath).size : 0} bytes`)
check('paper.md extracted on disk', fs.existsSync(mdPath), `${fs.existsSync(mdPath) ? fs.statSync(mdPath).size : 0} bytes`)
const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : ''
console.log(`  paper.md is ${md.length} chars`)

// 3. It shows in Library.
await w.click('button:has-text("Library")')
await w.waitForTimeout(1200)
const bodyText = await w.textContent('body')
check('paper appears in Library UI', bodyText.includes('Attention Is All You Need'))
await w.screenshot({ path: path.join(shots, '01-library.png') })

// 4. Reader renders the actual PDF.
await w.click(`div[role="listitem"]:has-text("Attention Is All You Need")`)
await w.waitForTimeout(3000)
const canvases = await w.evaluate(() => document.querySelectorAll('canvas').length)
check('reader renders PDF to canvas', canvases > 0, `${canvases} canvas element(s)`)
await w.screenshot({ path: path.join(shots, '02-reader.png') })

// 5. THE G0 CRITERION: Ask through signed-in Codex, streamed and grounded.
console.log('\nAsking a paper-specific question through signed-in Codex...')
const opened = await w.evaluate((slug) => window.vellum.askNewChat({ slug, backend: 'codex' }), ing.slug)
console.log(`  chat session id=${opened.session.id}`)

const QUESTION =
  'Using only the paper at data/papers/' + ing.slug + '/paper.md: what is the name of the model architecture this paper proposes, ' +
  'and how many encoder and decoder layers does its base configuration use? Quote the exact sentence that states the layer counts.'

const answer = await w.evaluate(async ({ sessionId, slug, text }) => {
  const events = []
  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  const unsub = window.vellum.onAskUpdate((p) => {
    if (p.requestId !== curId) return
    events.push(p.event)
    if (p.event.kind === 'done' || p.event.kind === 'error') resolveDone(p.event)
  })
  let curId = null
  const { requestId } = await window.vellum.askStart({ chatSessionId: sessionId, slug, text })
  curId = requestId
  const final = await Promise.race([
    done,
    new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300000)),
  ])
  unsub()
  return {
    final,
    kinds: events.map((e) => e.kind),
    text: events.filter((e) => e.kind === 'text').map((e) => e.text).join(''),
  }
}, { sessionId: opened.session.id, slug: ing.slug, text: QUESTION })

console.log(`  streamed event kinds: ${answer.kinds.join(', ')}`)
check('Ask streamed updates over ACP', answer.kinds.includes('text'), `${answer.kinds.length} events`)
check('Ask turn completed with done', answer.final?.kind === 'done', `final=${answer.final?.kind}`)
if (answer.final?.kind === 'error') console.log('  ERROR:', answer.final.message)

// NOTE: the final `done` message already contains the complete assistant text,
// so use exactly ONE source. Concatenating streamed chunks AND the final
// message duplicates the whole answer.
const reply = (answer.text.trim() || (answer.final?.kind === 'done' ? (answer.final.message?.content ?? '') : '')).trim()
fs.writeFileSync(path.join(shots, 'codex-answer.txt'), reply)
console.log(`\n--- Codex answer (${reply.length} chars) ---\n${reply.slice(0, 1500)}\n---`)

// 6. Grounding must be checked against the ACTUAL FILE, not against keywords.
//    (a) every block-quoted line the agent cited must appear verbatim in paper.md
//    (b) a negative control: a fact absent from this paper must not be asserted
const quoted = [...reply.matchAll(/^>\s*"?(.+?)"?\s*$/gm)].map((m) => m[1].trim()).filter((s) => s.length > 25)
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
const hay = norm(md)
let quotedFound = 0
for (const q of quoted) {
  if (hay.includes(norm(q))) quotedFound += 1
  else console.log(`  NOT FOUND VERBATIM IN paper.md: "${q.slice(0, 90)}..."`)
}
check('answer names the Transformer (paper-specific)', /transformer/i.test(reply))
check('answer cites >=1 quotation that exists verbatim in paper.md', quotedFound > 0, `${quotedFound}/${quoted.length} quotations verified`)
if (quoted.length) {
  check('every cited quotation is present in the paper (no fabrication)', quotedFound === quoted.length, `${quotedFound}/${quoted.length}`)
}
// Negative control: this paper's base config is 6 layers, not 12. Asserting 12
// would indicate the agent answered from priors rather than from the file.
const claimsTwelve = /\b(12|twelve)\b[^.\n]{0,30}\blayers?\b/i.test(reply)
check('answer does not fabricate a layer count absent from the paper', !claimsTwelve)

await w.screenshot({ path: path.join(shots, '03-ask-codex.png') })

// 7. Restart persistence.
console.log('\nRestarting app to verify durable state...')
const sessionTitle = opened.session.title
await app.close()
;({ app, w } = await launch())

const papers = await w.evaluate(() => window.vellum.listPapers({}))
check('paper survives restart', papers.some((p) => p.slug === ing.slug), `${papers.length} paper(s)`)
const reopened = await w.evaluate((s) => window.vellum.askOpen({ slug: s }), ing.slug)
check('chat session survives restart', !!reopened.session, `id=${reopened.session?.id}`)
check('chat history survives restart', (reopened.messages?.length ?? 0) > 0, `${reopened.messages?.length} message(s)`)
console.log(`  session title after restart: "${reopened.session?.title}" (was "${sessionTitle}")`)
await w.screenshot({ path: path.join(shots, '04-after-restart.png') })

// ---------- report ----------
const errs = consoleLog.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'))
const warns = consoleLog.filter((l) => l.startsWith('[warning]'))
console.log(`\nconsole: ${errs.length} error(s), ${warns.length} warning(s)`)
if (errs.length) console.log(errs.slice(0, 15).join('\n'))
if (warns.length) console.log(warns.slice(0, 10).join('\n'))
check('no renderer console errors', errs.length === 0, `${errs.length} error(s)`)

fs.writeFileSync(path.join(shots, 'console.log'), consoleLog.join('\n'))
console.log(`\nartifacts: ${shots}\ndata root: ${dataRoot}${isolated ? ' (isolated temp cwd)' : ' (repo cwd — NOT isolated)'}`)

await app.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n===== G0 CORE JOURNEY: ${results.length - failed.length}/${results.length} PASSED =====`)
if (failed.length) {
  console.log('FAILED:')
  failed.forEach((f) => console.log(`  - ${f.name} (${f.detail})`))
  process.exit(1)
}
console.log('ALL CHECKS PASSED')