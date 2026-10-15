// Live verification for the dotted-arXiv-slug purge defect.
// Reproduces the real user path: ingest a real arXiv paper -> Trash -> permanent purge.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'
import assert from 'assert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.join(__dirname, '../out/main/index.cjs')
const ARXIV_ID = '1706.03762'

const shots = path.join(__dirname, '../test-artifacts/purge-live')
fs.mkdirSync(shots, { recursive: true })

const app = await electron.launch({ args: ['--no-sandbox', APP], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })
const w = await app.firstWindow()
const logs = []
w.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
w.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await w.waitForLoadState('domcontentloaded')
await w.waitForSelector('footer:has-text("bridge: pong")', { timeout: 30000 })

console.log(`Ingesting real arXiv ${ARXIV_ID} (produces a DOTTED slug)...`)
const ing = await w.evaluate((id) => window.vellum.ingest(id), ARXIV_ID)
console.log(`  slug=${ing.slug}  title="${ing.title}"`)
assert(ing.slug.includes('.'), `expected a dotted arXiv slug, got ${ing.slug}`)

const papers = await w.evaluate(() => window.vellum.listPapers({}))
assert(papers.some((p) => p.slug === ing.slug), 'paper should be listed')
console.log('  listed in library: yes')

// Real user path: Trash via the UI affordance, then permanent purge.
console.log('\nMoving to Trash...')
const trashed = await w.evaluate((slug) => window.vellum.paperTrash(slug), ing.slug)
console.log(`  trash returned: ${JSON.stringify(trashed)}`)

console.log('Permanently purging (this is where the old code threw)...')
const purged = await w.evaluate((slug) => window.vellum.paperPurge(slug), ing.slug)
console.log(`  purge returned: ${JSON.stringify(purged)}`)

const after = await w.evaluate(() => window.vellum.listPapers({}))
assert(!after.some((p) => p.slug === ing.slug), 'paper must be gone from the library')
console.log('  removed from library: yes')

const dir = path.join(process.cwd(), 'data', 'papers', ing.slug)
assert(!fs.existsSync(dir), `paper directory must be deleted from disk (still exists: ${dir})`)
console.log(`  directory removed from disk: yes (${dir})`)

await w.screenshot({ path: path.join(shots, 'after-purge.png') })

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'))
console.log(`\nconsole: ${errs.length} error(s)`)
if (errs.length) console.log(errs.join('\n'))

await app.close()
console.log('\n=== [L2-04] LIVE PURGE VERIFICATION PASSED ===')