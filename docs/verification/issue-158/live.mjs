// Run after build and Electron SQLite rebuild: xvfb-run -a node docs/verification/issue-158/live.mjs
// Only disposable compiled output is instrumented. All PDF extraction/rendering remains real.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
const root = process.cwd()
const evidence = process.env.LIVE_EVIDENCE_DIR || root + '/docs/verification/issue-158'
fs.mkdirSync(evidence, {recursive:true})
const dir = fs.mkdtempSync('/tmp/vellum158-live-')
const papers = [
  {slug:'paper-a', title:'Attention Is All You Need', file:'/tmp/vellum-121-attention.pdf', needle:'Attention Is All You Need'},
  {slug:'paper-b', title:'Less Than One-Shot Learning', file:'/tmp/vellum-125-real-paper.pdf', needle:'Learning N Classes'},
]
for (const p of papers) {
  const folder = dir + '/papers/' + p.slug
  fs.mkdirSync(folder, {recursive:true})
  p.pdfPath = folder + '/paper.pdf'; p.mdPath = folder + '/paper.md'
  fs.copyFileSync(p.file,p.pdfPath)
  fs.writeFileSync(p.mdPath,'Real PDF live verification. No ingestion or ACP call.')
}
let main = fs.readFileSync(root+'/out/main/index.cjs','utf8')
assert(main.includes('  createWindow();'))
const seed = papers.map(p => `upsertPaper(getDb(), ${JSON.stringify({...p,authors:[],addedAt:'2026-11-06T00:00:00.000Z'})});`).join('\n')
main = main.replace('  createWindow();',seed+'\n  createWindow();')
const appPath = root+'/out/main/live158.cjs'
fs.writeFileSync(appPath,main)
const rendererPath = root+'/out/renderer/assets/'+fs.readdirSync(root+'/out/renderer/assets').find(p=>/^index-.*\.js$/.test(p))
const original = fs.readFileSync(rendererPath,'utf8')
const injection = `globalThis.reader158 = {mode:'normal', queue:[], finished:0,
 async search(doc,query,search) {
  const mode = this.mode; this.mode = 'normal';
  const results = await search(doc,query);
  if(mode === 'fail') throw Error('Injected search text unavailable');
  if(mode === 'hold') return await new Promise((resolve,reject)=>this.queue.push({query,results,resolve,reject}));
  return results;
 }};\n`
function instrument(source) {
 const needle = 'const results = await searchDocument(doc, query);'
 assert(source.includes(needle),'Reader search instrumentation anchor absent')
 return injection+source.replace(needle,'const results = await globalThis.reader158.search(doc, query, searchDocument);')
}
if (!process.env.LIVE_RENDERER_URL) fs.writeFileSync(rendererPath,instrument(original))
let app,w
const consoleLines=[]
const checks=[]
async function shot(name) {await w.screenshot({path:evidence+'/'+name+'.png'})}
async function record(name) {checks.push(name);console.log('PASS',name)}
async function launch() {
 app=await _electron.launch({args:['--no-sandbox','--user-data-dir='+dir+'/profile',appPath],env:{...process.env,ELECTRON_RUN_AS_NODE:'',VELLUM_DATA_DIR:dir,ELECTRON_RENDERER_URL:process.env.LIVE_RENDERER_URL||''}})
 app.process().stderr.on('data',d=>fs.appendFileSync(dir+'/main.log',d))
 w=await app.firstWindow();w.setDefaultTimeout(20000)
 w.on('console',m=>consoleLines.push('['+m.type()+'] '+m.text()))
 w.on('pageerror',e=>consoleLines.push('[pageerror] '+e))
 if(process.env.LIVE_RENDERER_URL) {
  await w.route('**/app/Reader.tsx*',async route=>{const response=await route.fetch();await route.fulfill({response,body:instrument(await response.text())})})
  await w.reload()
 }
 await w.getByText('bridge: pong',{exact:true}).waitFor()
}
const input=()=>w.getByRole('searchbox',{name:'Search in document'})
const search=()=>w.getByRole('main',{name:'Paper view'}).getByRole('button',{name:'Search',exact:true})
const matches=()=>w.getByLabel('Search matches',{exact:true})
const page=()=>w.getByLabel('Page',{exact:true})
const tab=i=>w.getByRole('tab',{name:papers[i].title,exact:true})
async function valid(i) {await w.waitForFunction(needle=>document.querySelector('[class*=textLayer]')?.textContent.includes(needle),papers[i].needle)}
async function open(i) {await w.getByRole('button',{name:'Library',exact:true}).click();await w.getByRole('button',{name:papers[i].title,exact:true}).click();await valid(i)}
async function mode(value) {await w.evaluate(value=>{globalThis.reader158.mode=value},value)}
async function held() {await w.waitForFunction(()=>globalThis.reader158.queue.length>0)}
async function release(fail=false) {
 await w.evaluate(fail=>{
  const r=globalThis.reader158.queue.shift();if(!r)throw Error('No held search')
  if(fail)r.reject(Error('Injected obsolete search failure'));else r.resolve(r.results)
 },fail)
 // Drain renderer promise continuations, then inspect React-visible state.
 await w.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
}
async function noResults() {assert.equal(await matches().count(),0);assert.equal(await w.getByRole('button',{name:'Next match'}).count(),0)}
async function settle() {await w.getByText('Searching…',{exact:true}).waitFor({state:'hidden'})}
async function select(i) {
 const span=w.locator('[class*=textLayer] > span').filter({hasText:papers[i].needle}).first()
 await span.scrollIntoViewIfNeeded();await span.dblclick()
 await w.getByRole('toolbar',{name:'Selection actions'}).waitFor()
}
try {
 await launch();await shot('empty');await open(1);await open(0)
 await input().fill('attention');await noResults();assert(await input().evaluate(e=>e===document.activeElement))
 await input().press('Tab');assert(await search().evaluate(e=>e===document.activeElement));await search().press('Enter')
 await matches().waitFor();assert.match(await matches().innerText(),/^1 \/ [1-9]/)
 await w.getByRole('button',{name:'Next match'}).click();assert.match(await matches().innerText(),/^2 \/ /)
 await shot('success');await record('real search, next match, keyboard submit and focus')
 await input().fill('vellum-no-match-158');await noResults();await input().press('Enter');await settle();assert.equal(await matches().innerText(),'0 / 0')
 await shot('no-matches');await record('unsubmitted input distinct from completed no matches')
 // Stay on page 2 while obsolete attention search would navigate to page 1.
 const stable=await page().innerText()
 await input().fill('attention');await mode('hold');await search().click();await held();assert(await search().isDisabled())
 await shot('pending');await input().fill('');assert(await search().isEnabled());await noResults();await release();await noResults();assert.equal(await page().innerText(),stable)
 await shot('cleared-stale');await record('pending clear invalidates late success and page jump')
 for(const failure of [false,true]) {
  await input().fill('attention');await mode('hold');await search().click();await held()
  await input().fill('network');assert(await search().isEnabled());await noResults()
  await mode('hold');await input().press('Enter');await w.waitForFunction(()=>globalThis.reader158.queue.length===2)
  await release(failure);assert(await search().isDisabled());assert.equal(await w.getByRole('alert').count(),0);await noResults();assert.equal(await page().innerText(),stable)
  await release();await matches().waitFor();assert(await search().isEnabled())
  // Return to page 2 for next stale search page-stability check.
  await w.locator('[class*=pageNav]').getByRole('button',{name:'›',exact:true}).click()
  await w.waitForFunction(()=>document.querySelector('[aria-label="Page"]').textContent.startsWith('2 of'))
  await record('pending edit, newer pending, stale '+(failure?'failure':'success')+' preserves loading and page')
 }
 await input().fill('attention');await mode('fail');await search().click();await w.getByRole('alert').waitFor()
 assert.match(await w.getByRole('alert').innerText(),/Injected search text unavailable.*Try Search again/);await noResults()
 await shot('search-error');await input().click();await input().press('Enter');await matches().waitFor();assert.equal(await w.getByRole('alert').count(),0)
 await shot('retry');await record('accessible recoverable current error, keyboard retry')
 await mode('hold');await search().click();await held();await tab(1).click();await valid(1);await release(true);await noResults();assert.equal(await w.getByRole('alert').count(),0)
 assert.equal(await input().inputValue(),'');assert.match(await page().innerText(),/^1 of/)
 await record('paper switch ignores held search failure and resets search')
 await select(1);await w.getByRole('button',{name:'Highlight yellow',exact:true}).click()
 await w.waitForFunction(()=>document.querySelectorAll('[class*=highlightRect]').length>0)
 await w.getByRole('tab',{name:'Notes',exact:true}).click();await w.getByRole('textbox',{name:'Note',exact:true}).fill('Issue 158 saved research note')
 await w.getByText('Saved',{exact:true}).waitFor();await shot('saved-research')
 await tab(0).click();await valid(0);await tab(1).click();await valid(1)
 await w.waitForFunction(()=>document.querySelectorAll('[class*=highlightRect]').length>0)
 assert.equal(await w.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Issue 158 saved research note')
 await app.close();app=undefined;await launch();await open(1)
 await w.waitForFunction(()=>document.querySelectorAll('[class*=highlightRect]').length>0)
 await w.getByRole('tab',{name:'Notes',exact:true}).click();assert.equal(await w.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Issue 158 saved research note')
 await shot('restart');await record('paper switches and process restart preserve saved note/highlight')
 const expectedTermination = /^\[warning\] Warning: getTextContent - ignoring errors during "GetTextContent: page \d+" task: "Error: Worker task was terminated"\.$/
 const terminationWarnings = consoleLines.filter(s=>expectedTermination.test(s))
 const errors=consoleLines.filter(s=>/^\[(error|warning|pageerror)\]/.test(s) && !expectedTermination.test(s))
 fs.writeFileSync(evidence+'/console.txt',consoleLines.join('\n')+'\n')
 assert.deepEqual(errors,[])
 fs.writeFileSync(evidence+'/live-results.json',JSON.stringify({dir,checks,errors,terminationWarnings,papers:papers.map(({file,title})=>({file,title}))},null,2)+'\n')
 console.log('PASS zero unexpected warnings/errors/pageerrors; expected upstream termination warnings',terminationWarnings.length,'isolated state',dir)
} catch(error) {
 if(w)await shot('failure').catch(()=>{})
 fs.writeFileSync(evidence+'/console.txt',consoleLines.join('\n')+'\n')
 console.error('Isolated state:',dir);throw error
} finally {
 if(app)await app.close()
 fs.unlinkSync(appPath);fs.writeFileSync(rendererPath,original)
}
