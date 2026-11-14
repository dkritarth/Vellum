// From this checkout after npm run build:
// xvfb-run -a node docs/verification/issue-173/live.mjs
// Seed only a disposable main bundle. Renderer, PDF.js, IPC, highlights and notes are real.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
const root = process.cwd()
const evidence = process.env.LIVE_EVIDENCE_DIR || root + '/docs/verification/issue-173'
fs.mkdirSync(evidence, { recursive: true })
const dir = fs.mkdtempSync('/tmp/vellum173-live-')
const sourcePdf = process.env.LIVE_PDF || '/tmp/vellum-121-attention.pdf'
const folder = dir + '/papers/attention'
fs.mkdirSync(folder, { recursive: true })
fs.copyFileSync(sourcePdf, folder + '/paper.pdf')
fs.writeFileSync(folder + '/paper.md', 'Live reader verification uses real PDF. No ingestion or model call.')
const paper = { slug:'attention', title:'Attention Is All You Need', authors:[], pdfPath:folder+'/paper.pdf', mdPath:folder+'/paper.md', addedAt:'2026-11-06T00:00:00.000Z' }
const main = fs.readFileSync(root + '/out/main/index.cjs', 'utf8')
assert(main.includes('  createWindow();'))
const appPath = root + '/out/main/live173.cjs'
const seed = `upsertPaper(getDb(), ${JSON.stringify(paper)});\n  createWindow();`
fs.writeFileSync(appPath, main.replace('  createWindow();', seed))
let app, w
const consoleLines = [], checks = [], selections = []
const toolbar = () => w.getByRole('toolbar', {name:'Selection actions'})
const page = () => w.getByLabel('Page', {exact:true})
const overlays = () => w.locator('[class*=highlightRect]')
const rows = () => w.locator('button').filter({has: w.locator('[class*=quote]')})
async function shot(name) { await w.screenshot({path:evidence+'/'+name+'.png'}) }
function record(name) { checks.push(name); console.log('PASS',name) }
async function launch() {
 app = await _electron.launch({args:['--no-sandbox','--user-data-dir='+dir+'/profile',appPath], env:{...process.env,ELECTRON_RUN_AS_NODE:'',ELECTRON_RENDERER_URL:process.env.LIVE_RENDERER_URL || '',VELLUM_DATA_DIR:dir}})
 app.process().stderr.on('data', d => fs.appendFileSync(dir+'/main.log', d))
 w = await app.firstWindow(); w.setDefaultTimeout(20000)
 w.on('console', m => consoleLines.push('['+m.type()+'] '+m.text()))
 w.on('pageerror', e => consoleLines.push('[pageerror] '+e))
 await w.getByText('bridge: pong', {exact:true}).waitFor()
}
async function ready(n) {
 await w.waitForFunction(n => document.querySelector('[aria-label="Page"]')?.textContent.startsWith(n+' of'), n)
 await w.locator('[class*=textLayer] > span').first().waitFor()
 // pageReady exposes text only after the current raster and native text layer complete.
 await w.locator('[class*=textLayer]').waitFor({state:'visible'})
}
async function open() {
 await w.getByRole('button',{name:'Library',exact:true}).click()
 await w.getByRole('button',{name:paper.title,exact:true}).click(); await ready(1)
}
async function selectNative() {
 const needle = (await page().innerText()).startsWith('1 of') ? 'Attention Is All You Need' : 'Introduction'
 const span = w.locator('[class*=textLayer] > span').filter({hasText:needle}).first()
 await span.scrollIntoViewIfNeeded(); await span.dblclick()
 await toolbar().waitFor()
 const quote = await w.evaluate(() => window.getSelection().toString())
 assert.match(quote, /[A-Za-z]{3}/)
 selections.push({page:await page().innerText(),quote})
 return quote
}
async function annotation(n) {
 return rows().filter({hasText:'Page '+n}).first()
}
async function jump(n) { await (await annotation(n)).click(); await ready(n); await toolbar().waitFor({state:'hidden'}) }
async function flash() { await w.waitForFunction(() => !!document.querySelector('[class*=highlightRectFlash]')) }
try {
 await launch(); await shot('empty'); await open()
 await w.getByRole('tab',{name:'Annotations',exact:true}).click()
 await w.getByText('No highlights yet', {exact:false}).waitFor(); record('empty annotations state')
 await selectNative(); await w.getByRole('button',{name:'Highlight yellow',exact:true}).click()
 await overlays().first().waitFor()
 await w.locator('[class*=pageNav]').getByRole('button',{name:'›',exact:true}).click(); await ready(2)
 await selectNative(); await w.getByRole('button',{name:'Highlight green',exact:true}).click()
 await overlays().first().waitFor()
 // Remount panel to load both highlights through real persisted IPC.
 await w.getByRole('tab',{name:'Notes',exact:true}).click()
 await w.getByRole('textbox',{name:'Note',exact:true}).fill('Issue 173 preserved research note')
 await w.getByText('Saved',{exact:true}).waitFor()
 await w.getByRole('tab',{name:'Annotations',exact:true}).click(); await rows().nth(1).waitFor()
 assert.equal(await rows().count(),2)
 await jump(1); await selectNative(); await shot('outgoing-selection')
 await jump(2); await flash(); await shot('cross-page-retired')
 assert(await (await annotation(2)).evaluate(e => e === document.activeElement))
 record('native page 1 selection then visible page 2 annotation removes actions, renders destination and flashes; row retains focus')
 await selectNative(); await (await annotation(2)).click(); await toolbar().waitFor({state:'hidden'}); await flash()
 await w.waitForFunction(() => !document.querySelector('[class*=highlightRectFlash]'))
 await (await annotation(2)).press('Enter'); await flash()
 assert(await (await annotation(2)).evaluate(e => e === document.activeElement))
 await shot('same-page-flash'); record('same-page selection retirement, flash expiry and keyboard reflash')
 // Actual row clicks, without waiting for intervening page rendering.
 await (await annotation(1)).click(); await (await annotation(2)).click(); await (await annotation(1)).click()
 await ready(1); await flash(); assert.equal(await toolbar().count(),0)
 record('rapid annotation jumps finish on latest page with flash and no stale actions')
 await jump(2)
 const freshQuote = await selectNative()
 await w.getByRole('button',{name:'Add to chat',exact:true}).click()
 const composer = w.getByRole('textbox',{name:'Ask a question',exact:true})
 await w.waitForFunction(quote => document.querySelector('[aria-label="Ask a question"]')?.value === '> "'+quote+'" (p. 2)', freshQuote)
 assert(await composer.evaluate(e => e === document.activeElement))
 assert.equal(await toolbar().count(),0); await shot('destination-chat-context')
 record('fresh destination native quote enters Ask composer with page 2, composer focused, no send/model call')
 await w.getByRole('tab',{name:'Annotations',exact:true}).click(); assert.equal(await rows().count(),2)
 await w.getByRole('tab',{name:'Notes',exact:true}).click(); assert.equal(await w.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Issue 173 preserved research note')
 await app.close(); app=undefined; await launch(); await open()
 await overlays().first().waitFor()
 await w.getByRole('tab',{name:'Annotations',exact:true}).click(); await rows().nth(1).waitFor(); assert.equal(await rows().count(),2)
 await jump(2); await flash()
 await w.getByRole('tab',{name:'Notes',exact:true}).click(); assert.equal(await w.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Issue 173 preserved research note')
 await shot('restart-preserved'); record('process restart preserves both native-created highlights and note; restored page 2 annotation works')
 const expectedTermination = /^\[warning\] Warning: getTextContent - ignoring errors during "GetTextContent: page \d+" task: "Error: Worker task was terminated"\.$/
 const terminationWarnings = consoleLines.filter(s=>expectedTermination.test(s))
 const errors = consoleLines.filter(s=>/^\[(error|warning|pageerror)\]/.test(s) && !expectedTermination.test(s))
 fs.writeFileSync(evidence+'/console.txt',consoleLines.join('\n')+'\n')
 assert.deepEqual(errors,[])
 fs.writeFileSync(evidence+'/live-results.json',JSON.stringify({dir,sourcePdf,rendererUrl:process.env.LIVE_RENDERER_URL || 'built renderer',checks,selections,errors,terminationWarnings,injection:seed,rendererInjection:'None'},null,2)+'\n')
 record('zero unexpected renderer console warnings/errors/pageerrors')
} catch(error) {
 if(w) await shot('failure').catch(()=>{})
 fs.writeFileSync(evidence+'/console.txt',consoleLines.join('\n')+'\n')
 console.error('Isolated state',dir); throw error
} finally {
 if(app) await app.close()
 fs.copyFileSync(dir+'/main.log', evidence+'/main-stderr.txt')
 fs.unlinkSync(appPath)
}
