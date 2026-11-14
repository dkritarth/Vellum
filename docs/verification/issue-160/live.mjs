import fs from 'node:fs'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const root=process.cwd(), require=createRequire(root+'/package.json')
const {_electron:electron}=require('playwright')
const {extractText}=await import(root+'/node_modules/unpdf/dist/index.mjs')
const dir=fs.mkdtempSync('/tmp/vellum160-live-'), paper=dir+'/papers/attention'
fs.mkdirSync(paper,{recursive:true})
const bytes=fs.readFileSync(process.env.VELLUM_TEST_PDF || '/tmp/vellum-121-attention.pdf')
fs.writeFileSync(paper+'/paper.pdf',bytes)
const markdown=(await extractText(new Uint8Array(bytes),{mergePages:true})).text
fs.writeFileSync(paper+'/paper.md',markdown)
fs.mkdirSync(dir+'/papers/other-paper',{recursive:true});fs.copyFileSync(paper+'/paper.pdf',dir+'/papers/other-paper/paper.pdf');fs.copyFileSync(paper+'/paper.md',dir+'/papers/other-paper/paper.md')
fs.writeFileSync('/tmp/vellum160-data-path',dir)
const log=dir+'/transport.jsonl', consoleLines=[]
const injection=`
let live160Session = 0;
StdioAcpClient.prototype.newSession = async function() {
 const id=++live160Session;
 return {async *prompt(req) {
 require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({id,text:req.text})+'\\n');
 const reason=['cancelled','max_tokens','max_turn_requests'].find(r=>req.text.endsWith('Question: FAIL '+r));
 yield {kind:'text',data:{type:'text',text:reason?'The evidence is':'Completed paper answer'}};
 await new Promise(resolve=>setTimeout(resolve,900));
 yield {kind:'done',data:{stopReason:reason||'end_turn',usage:{inputTokens:20,outputTokens:5,totalTokens:25}}};
 },async dispose(){require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({disposed:id})+'\\n')}};
};
`
const appPath=root+'/out/main/live160.cjs'
let compiled=fs.readFileSync(root+'/out/main/index.cjs','utf8')
assert(compiled.includes('let chatManager;'))
compiled=compiled.replace('let chatManager;',injection+'\nlet chatManager;')
assert(compiled.includes('  createWindow();'))
compiled=compiled.replace('  createWindow();',`  for (const [slug,title] of [['attention','Attention Is All You Need'],['other-paper','Other isolated paper']]) upsertPaper(getDb(),{slug,title,authors:[],addedAt:new Date().toISOString(),mdPath:${JSON.stringify(paper+'/paper.md')},pdfPath:${JSON.stringify(paper+'/paper.pdf')}});\n  createWindow();`)
fs.writeFileSync(appPath,compiled)
let app,w
const input=()=>w.getByRole('textbox',{name:'Ask a question',exact:true})
async function ready(){await w.waitForFunction(()=>{const e=document.querySelector('input[aria-label="Ask a question"]');return e&&!e.disabled})}
async function launch(){
 app=await electron.launch({args:['--user-data-dir='+dir+'/profile',appPath],env:{...process.env,ELECTRON_RUN_AS_NODE:'',VELLUM_DATA_DIR:dir}})
 app.process().stderr.on('data',d=>fs.appendFileSync(dir+'/main.log',d))
 app.process().stdout.on('data',d=>fs.appendFileSync(dir+'/main.log',d))
 w=await app.firstWindow();w.on('console',m=>consoleLines.push(`[${m.type()}] ${m.text()}`));w.on('pageerror',e=>consoleLines.push('[pageerror] '+e));await w.waitForSelector('footer:has-text("bridge: pong")')
}
async function open(title){await w.getByRole('button',{name:'Library',exact:true}).click();await w.getByText(title,{exact:true}).first().click();await w.getByRole('tab',{name:'Ask',exact:true}).click();await ready()}
async function send(text){await input().fill(text);await w.getByRole('button',{name:'Send',exact:true}).click();await w.waitForFunction(()=>document.querySelector('input[aria-label="Ask a question"]')?.disabled);await ready()}
async function rename(title){const ss=await w.evaluate(()=>window.vellum.chatListSessions());const s=ss.find(x=>x.paperSlug==='attention');await w.evaluate(({id,title})=>window.vellum.chatRenameSession({id,title}),{id:s.id,title});return s.id}
async function reopen(title){await w.getByRole('tab',{name:'Chats',exact:true}).click();await w.getByRole('option').filter({hasText:title}).click();await ready()}
try{
 await launch();await open('Other isolated paper');await send('OTHER preserved question');
 await w.getByRole('tab',{name:'Notes',exact:true}).click();await w.getByRole('textbox',{name:'Note',exact:true}).fill('OTHER preserved note');await w.getByText('Saved',{exact:true}).waitFor();
 await open('Attention Is All You Need');assert((await w.locator('body').innerText()).includes('Ask a question about this paper.'));await w.screenshot({path:dir+'/empty.png'});
 await w.getByRole('combobox',{name:'Model backend'}).selectOption('codex');await ready();await send('HISTORY preserved question');await rename('Preserved history');await w.getByRole('button',{name:'New chat',exact:true}).click();await ready();
 const cases=[];
 for(const reason of ['cancelled','max_tokens','max_turn_requests']){
  if(cases.length){await w.getByRole('button',{name:'New chat',exact:true}).click();await ready()}
  await send('BASE '+reason);const chatId=await rename('Terminal '+reason);
  await input().fill('FAIL '+reason);await w.getByRole('button',{name:'Send',exact:true}).click();await w.getByText('The evidence is',{exact:true}).waitFor();assert(await input().isDisabled());await w.screenshot({path:dir+'/'+reason+'-partial.png'});
  await ready();await w.getByRole('alert').filter({hasText:reason}).waitFor();assert.equal(await w.getByText('The evidence is',{exact:true}).count(),0);assert.equal(await input().inputValue(),'');assert(await w.getByText('FAIL '+reason,{exact:true}).isVisible());assert(await w.getByText('BASE '+reason,{exact:true}).isVisible());await input().focus();assert(await input().evaluate(e=>e===document.activeElement));await input().fill('RETRY '+reason);await w.keyboard.press('Tab');assert(await w.getByRole('button',{name:'Send',exact:true}).evaluate(e=>e===document.activeElement));await w.screenshot({path:dir+'/'+reason+'-error.png'});
  await w.getByRole('button',{name:'Send',exact:true}).click();await w.waitForFunction(()=>document.querySelector('input[aria-label="Ask a question"]')?.disabled);await ready();assert.equal(await w.getByRole('alert').count(),0);assert.equal(await w.getByText('Completed paper answer',{exact:true}).count(),2);await w.screenshot({path:dir+'/'+reason+'-retry.png'});
  const records=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);const failed=records.find(r=>r.text?.endsWith('Question: FAIL '+reason));const retry=records.find(r=>r.text?.endsWith('Question: RETRY '+reason));assert.notEqual(failed.id,retry.id);assert(records.some(r=>r.disposed===failed.id));assert(retry.text.includes('User: FAIL '+reason));assert(retry.text.includes('Assistant: Completed paper answer'));assert(!retry.text.includes('The evidence is'));cases.push({reason,chatId,failedSession:failed.id,retrySession:retry.id});
 }
 await reopen('Preserved history');await w.getByText('HISTORY preserved question',{exact:true}).waitFor();assert.equal(await w.getByText('The evidence is',{exact:true}).count(),0);
 await open('Other isolated paper');await w.getByText('OTHER preserved question',{exact:true}).first().waitFor();await w.getByRole('tab',{name:'Notes',exact:true}).click();assert.equal(await w.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'OTHER preserved note');await w.screenshot({path:dir+'/other-preserved.png'});
 await app.close();app=null;await launch();
 for(const {reason} of cases){await reopen('Terminal '+reason);await w.getByText('FAIL '+reason,{exact:true}).waitFor();await w.getByText('RETRY '+reason,{exact:true}).waitFor();assert.equal(await w.getByText('The evidence is',{exact:true}).count(),0);assert.equal(await w.getByText('Completed paper answer',{exact:true}).count(),2);await w.screenshot({path:dir+'/'+reason+'-restart.png'})}
 await reopen('Preserved history');await w.getByText('HISTORY preserved question',{exact:true}).waitFor();await open('Other isolated paper');await w.getByText('OTHER preserved question',{exact:true}).first().waitFor();await w.getByRole('tab',{name:'Notes',exact:true}).click();assert.equal(await w.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'OTHER preserved note');await w.screenshot({path:dir+'/restart.png'});
 fs.writeFileSync(dir+'/renderer.log',JSON.stringify(consoleLines,null,2));fs.writeFileSync(dir+'/result.json',JSON.stringify({cases,pdfBytes:bytes.length,markdownCharacters:markdown.length,consoleLines},null,2));assert.deepEqual(consoleLines.filter(x=>/^\[(error|warning|pageerror)\]/.test(x)),[]);console.log('PASS',dir,JSON.stringify(cases));
}finally{if(app)await app.close();fs.rmSync(appPath,{force:true});fs.writeFileSync(dir+'/renderer.log',JSON.stringify(consoleLines,null,2))}
