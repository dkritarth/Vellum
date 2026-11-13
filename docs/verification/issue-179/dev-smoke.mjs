import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const root = fs.mkdtempSync('/tmp/vellum179-dev-')
fs.mkdirSync(`${root}/bin`)
for (const bin of ['codex-acp', 'claude-code-acp']) fs.writeFileSync(`${root}/bin/${bin}`, '#!/bin/sh\nexit 127\n', { mode: 0o755 })
const child = spawn('npm', ['run', 'dev', '--', '--noSandbox', '--remoteDebuggingPort', '19379', '--', `--user-data-dir=${root}/profile`], {
  detached: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', VELLUM_DATA_DIR: `${root}/data`, XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`, PATH: `${root}/bin:${process.env.PATH}` },
})
const lines = []
let browser
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools startup timeout')), 30000)
    const output = (chunk) => {
      const text = chunk.toString(); lines.push(text)
      if (text.includes('DevTools listening')) { clearTimeout(timeout); resolve() }
    }
    child.stdout.on('data', output); child.stderr.on('data', output)
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`dev exited ${code}`)) })
  })
  browser = await chromium.connectOverCDP('http://127.0.0.1:19379')
  const page = browser.contexts()[0].pages()[0]
  const consoleLines = []
  page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => consoleLines.push(`[pageerror] ${error}`))
  await page.waitForSelector('footer:has-text("bridge: pong")')
  await page.getByRole('tab', { name: 'Annotations', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('textbox', { name: 'Paper identifier or URL' }).fill('/tmp/vellum-121-attention.pdf')
  await page.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('[class*="textLayer"]')?.textContent?.includes('Attention'))
  const box = await page.evaluate(() => {
    const span = [...document.querySelectorAll('[class*="textLayer"] span')].find((el) => el.textContent.length > 16 && el.getBoundingClientRect().top > 280 && el.getBoundingClientRect().bottom < innerHeight - 60)
    const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 18)
    const r = range.getBoundingClientRect(); return { x: r.left + 1, y: r.top + r.height / 2, end: r.right - 1 }
  })
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.end, box.y, { steps: 15 }); await page.mouse.up()
  const quote = await page.evaluate(() => window.getSelection().toString().trim())
  assert(quote)
  await page.getByRole('button', { name: 'Highlight yellow', exact: true }).click()
  await page.getByRole('complementary', { name: 'Paper panel' }).getByRole('button', { name: `${quote} Page 1`, exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/vellum179-evidence/dev-immediate-row.png' })
  await page.getByRole('button', { name: `Delete highlight: ${quote}`, exact: true }).click()
  await page.getByText(/No highlights yet/).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length === 0)
  const papers = await page.evaluate(() => window.vellum.listPapers())
  assert.equal((await page.evaluate(slug => window.vellum.highlightsList(slug), papers[0].slug)).length, 0)
  await page.screenshot({ path: '/tmp/vellum179-evidence/dev-after-delete.png' })
  fs.writeFileSync('/tmp/vellum179-evidence/dev-console.log', consoleLines.join('\n'))
  assert.deepEqual(consoleLines.filter((line) => /^\[(error|warning|pageerror)\]/.test(line)), [])
  console.log(`PASS npm run dev actual Electron native selection creates immediate row and Delete removes overlay/list/storage without navigation. Isolated root ${root}`)
} finally {
  if (browser) await browser.close()
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  fs.writeFileSync('/tmp/vellum179-evidence/dev-main.log', lines.join(''))
}
