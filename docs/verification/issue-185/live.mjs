// Run from checkout after build and private Electron SQLite rebuild, under Xvfb.
// VELLUM_185_PDF names a real Attention Is All You Need PDF.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const root = process.cwd(), require = createRequire(root + '/package.json')
const { _electron } = require('playwright')
const { extractText } = await import(root + '/node_modules/unpdf/dist/index.mjs')
const dir = fs.mkdtempSync('/tmp/vellum185-live-'), slug = 'attention', title = 'Attention Is All You Need'
const folder = dir + '/papers/' + slug
fs.mkdirSync(folder, { recursive: true })
const pdf = fs.readFileSync(process.env.VELLUM_185_PDF)
fs.writeFileSync(folder + '/paper.pdf', pdf)
fs.writeFileSync(folder + '/paper.md', (await extractText(new Uint8Array(pdf), { mergePages: true })).text)
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const hashes = ['paper.pdf', 'paper.md'].map(file => hash(folder + '/' + file))
let compiled = fs.readFileSync(root + '/out/main/index.cjs', 'utf8')
function replace(before, after) {
  assert(compiled.includes(before), 'Missing instrumentation anchor: ' + before)
  compiled = compiled.replace(before, after)
}
replace('let chatManager;', `
globalThis.ask185 = { starts: [], opens: [], pending: [], hold: false, releaseTurn: null };
StdioAcpClient.prototype.newSession = async function () {
  return { async *prompt() {
    yield {kind: 'text', data: {type: 'text', text: 'Controlled active prefix'}};
    await new Promise(resolve => { globalThis.ask185.releaseTurn = resolve; });
    globalThis.ask185.releaseTurn = null;
    yield {kind: 'text', data: {type: 'text', text: ' and final reply'}};
    yield {kind: 'done', data: {stopReason: 'end_turn'}};
  }, async dispose() {} };
};
let chatManager;`)
replace('  const parsed = parseAskStartParams(params);', '  const parsed = parseAskStartParams(params);\n  globalThis.ask185.starts.push(parsed);')
replace('electron.ipcMain.handle("vellum:ask-open", (_event, slugOrParams, maybeSessionId) => {', `electron.ipcMain.handle("vellum:ask-open", async (_event, slugOrParams, maybeSessionId) => {
  globalThis.ask185.opens.push(slugOrParams);
  if (globalThis.ask185.hold) await new Promise((resolve, reject) => globalThis.ask185.pending.push({resolve, reject}));`)
const paper = {slug, title, authors:['Ashish Vaswani et al.'], addedAt:new Date().toISOString(), pdfPath:folder+'/paper.pdf', mdPath:folder+'/paper.md'}
replace('  createWindow();', `if (listPapers(getDb(), {}).length === 0) {
  upsertPaper(getDb(), ${JSON.stringify(paper)});
  createChatSession(getDb(), {paperSlug: '${slug}', backend: 'codex', title: 'Requested research'});
  addChatMessage(getDb(), {sessionId: 1, role: 'assistant', content: 'Saved requested history'});
  createChatSession(getDb(), {paperSlug: '${slug}', backend: 'codex', title: 'Other research'});
  addChatMessage(getDb(), {sessionId: 2, role: 'assistant', content: 'Other saved history'});
  upsertNote(getDb(), '${slug}', 'Preserved research note');
}
  createWindow();`)
const appPath = root + '/out/main/issue185-live.cjs'
fs.writeFileSync(appPath, compiled)
let app, page
const consoleLines = [], records = []
const input = () => page.getByRole('textbox', {name:'Ask a question', exact:true})
const retry = () => page.getByRole('button', {name:'Retry', exact:true})
async function launch() {
  app = await _electron.launch({args:['--no-sandbox','--user-data-dir='+dir+'/profile',appPath], env:{...process.env,ELECTRON_RUN_AS_NODE:'',VELLUM_DATA_DIR:dir,ELECTRON_RENDERER_URL:process.env.VELLUM_185_RENDERER_URL || ''}})
  app.process().stderr.on('data', data => fs.appendFileSync(dir+'/main.log',data))
  page = await app.firstWindow(); page.setDefaultTimeout(10000)
  page.on('console', message => consoleLines.push(`[${message.type()}] ${message.text()}`))
  page.on('pageerror', error => consoleLines.push('[pageerror] '+error))
  await page.getByText('bridge: pong', {exact:true}).waitFor()
}
async function hold(value) { await app.evaluate((_, value) => {globalThis.ask185.hold=value},value) }
async function pending() { await app.evaluate(async () => {while(!globalThis.ask185.pending.length) await new Promise(r=>setTimeout(r,10))}) }
async function release(fail=false) {
  await pending()
  // Development StrictMode mounts twice; release canceled and current snapshots.
  await app.evaluate((_, fail) => {for(const p of globalThis.ask185.pending.splice(0)) {if(fail)p.reject(Error('Injected delayed read failure'));else p.resolve()}},fail)
}
async function selectChat(name) {
  await page.getByRole('tab',{name:'Chats',exact:true}).click()
  await page.getByText(name,{exact:true}).click()
}
async function keyboardRetry() {
  // Native Tab traversal from current focus; no programmatic focus/click.
  for(let i=0;i<30;i++) {
    await page.keyboard.press('Tab')
    if(await retry().evaluate(e=>e===document.activeElement)) {
      await page.screenshot({path:dir+'/retry-focus.png'})
      await page.keyboard.press('Enter'); return
    }
  }
  throw Error('Retry unreachable by Tab')
}
async function idle() { await page.waitForFunction(()=>document.querySelector('[aria-label="Ask a question"]')?.disabled===false) }
try {
  await launch(); await hold(true)
  await selectChat('Requested research'); await pending()
  assert(await input().isDisabled())
  await page.getByRole('status').filter({hasText:'Loading chat…'}).waitFor()
  await page.screenshot({path:dir+'/loading.png'})
  await release(true)
  await page.getByRole('alert').filter({hasText:'Injected delayed read failure'}).waitFor()
  assert(await retry().isEnabled()); assert(await input().isDisabled())
  assert(await page.getByRole('button',{name:'New chat',exact:true}).isDisabled())
  await page.screenshot({path:dir+'/failure.png'})
  await keyboardRetry(); await pending()
  assert.equal(await retry().count(),0)
  await release(true); await retry().waitFor()
  await page.screenshot({path:dir+'/repeated-failure.png'})
  await keyboardRetry(); await pending(); await hold(false); await release()
  await page.getByText('Saved requested history',{exact:true}).waitFor(); await idle()
  const opens = await app.evaluate(()=>globalThis.ask185.opens)
  assert.equal(opens.length,process.env.VELLUM_185_RENDERER_URL ? 4 : 3)
  for(const open of opens) assert.deepEqual(open,{slug,sessionId:1})
  assert.equal((await page.evaluate(()=>window.vellum.chatListSessions({}))).length,2)
  await page.screenshot({path:dir+'/recovered.png'})
  records.push('Delayed initial open, keyboard Retry, repeated failure, same requested session/history, no extra conversations.')
  await input().pressSequentially('  First paragraph'); await input().press('Shift+Enter'); await input().press('Shift+Enter'); await input().pressSequentially('Second paragraph  ')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByText('Controlled active prefix',{exact:true}).waitFor()
  const starts = await app.evaluate(()=>globalThis.ask185.starts)
  assert.deepEqual(starts,[{slug,chatSessionId:1,text:'First paragraph\n\nSecond paragraph'}])
  // Remount during a genuinely held ChatManager turn, fail its open, then restore it via Retry.
  await page.getByRole('tab',{name:'Notes',exact:true}).click()
  assert.equal(await page.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Preserved research note')
  await hold(true); await page.getByRole('tab',{name:'Ask',exact:true}).click(); await pending(); await release(true); await retry().waitFor()
  await keyboardRetry(); await pending(); await hold(false); await release()
  await page.getByText('Controlled active prefix',{exact:true}).waitFor()
  assert(await input().isDisabled()); assert(await page.getByRole('button',{name:'Sending…',exact:true}).isDisabled())
  await page.screenshot({path:dir+'/restored-active.png'})
  await app.evaluate(()=>globalThis.ask185.releaseTurn())
  await page.getByText('Controlled active prefix and final reply',{exact:true}).waitFor(); await idle()
  assert.equal((await app.evaluate(()=>globalThis.ask185.starts)).length,1)
  records.push('Exact native multiline Send; real ChatManager held turn restored after failed open/Retry, then completed without duplicate start.')
  // Hold retry, navigate to another session, revisit original, then settle stale open.
  await page.getByRole('tab',{name:'Notes',exact:true}).click(); await hold(true)
  await page.getByRole('tab',{name:'Ask',exact:true}).click(); await pending(); await release(true); await retry().waitFor()
  await keyboardRetry(); await pending(); await hold(false)
  await selectChat('Other research'); await page.getByText('Other saved history',{exact:true}).waitFor()
  await selectChat('Requested research'); await page.getByText('Saved requested history',{exact:true}).waitFor(); await idle()
  await input().fill('Destination draft')
  await release(); assert.equal(await input().inputValue(),'Destination draft'); assert.equal(await retry().count(),0)
  await page.screenshot({path:dir+'/navigation.png'})
  records.push('Navigation to other session and revisit while retry pending; stale success leaves destination draft/history intact.')
  const snapshot = await page.evaluate(()=>window.vellum.askOpen({slug:'attention',sessionId:1}))
  await app.close(); app=null; await launch(); await selectChat('Requested research'); await idle()
  const restored = await page.evaluate(()=>window.vellum.askOpen({slug:'attention',sessionId:1}))
  assert.deepEqual(restored.messages,snapshot.messages)
  await page.getByRole('tab',{name:'Notes',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Note"]')?.value==='Preserved research note')
  assert.deepEqual(['paper.pdf','paper.md'].map(file=>hash(folder+'/'+file)),hashes)
  await page.screenshot({path:dir+'/restart-note.png'})
  records.push('Process restart preserves exact requested history, multiline user text, note, PDF and markdown hashes.')
  const errors=consoleLines.filter(line=>/^\[(error|warning|pageerror)\]/.test(line))
  assert.deepEqual(errors,[])
  fs.writeFileSync(dir+'/result.json',JSON.stringify({passed:true,dir,records,opens,starts,restored:restored.messages,hashes,errors,pdfBytes:pdf.length},null,2))
  console.log(JSON.stringify({dir,records,errors},null,2))
} catch(error) {
  if(page) await page.screenshot({path:dir+'/harness-failure.png'}).catch(()=>{})
  console.error(dir,error); throw error
} finally {
  fs.writeFileSync(dir+'/renderer.log',consoleLines.join('\n'))
  if(app) await app.close()
  fs.unlinkSync(appPath)
}
