// Run from repo root: xvfb-run -a node docs/verification/issue-171/dev.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum171-dev-'))
const evidence = path.resolve('docs/verification/issue-171')
const server = net.createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
for (const name of ['codex-acp', 'claude-code-acp']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
const child = spawn('npm', ['run', 'dev', '--', '--', '--user-data-dir=' + path.join(dir, 'profile')], { detached: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', VELLUM_DATA_DIR: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_CACHE_HOME: path.join(dir, 'cache'), NO_SANDBOX: '1', REMOTE_DEBUGGING_PORT: String(port), ELECTRON_CLI_ARGS: JSON.stringify(['--no-sandbox', '--user-data-dir=' + path.join(dir, 'profile')]), PATH: bin + ':' + process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
const consoleLines = []
child.stdout.on('data', data => { output += data })
child.stderr.on('data', data => { output += data })
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); break } catch { await new Promise(resolve => setTimeout(resolve, 200)) }
  }
  assert(browser, 'Development Electron debug port ready')
  const w = browser.contexts()[0].pages()[0]
  w.on('console', message => consoleLines.push(`[${message.type()}] ${message.text()}`))
  w.on('pageerror', error => consoleLines.push('[pageerror] ' + error.stack))
  const tree = w.getByRole('tree', { name: 'Collections' })
  await tree.getByText(/No collections yet/).waitFor()
  await w.getByRole('button', { name: 'New Collection' }).focus()
  await w.keyboard.press('Enter')
  const input = w.getByPlaceholder('Collection name...')
  assert(await input.evaluate(element => document.activeElement === element))
  await input.fill('Development collection')
  await input.press('Tab')
  assert(await w.getByRole('button', { name: 'Add', exact: true }).evaluate(element => document.activeElement === element))
  await w.keyboard.press('Enter')
  await tree.getByText('Development collection', { exact: true }).waitFor()
  await w.getByRole('button', { name: 'Rename Development collection' }).click()
  await tree.getByRole('textbox').fill('Development renamed')
  await tree.getByRole('textbox').press('Enter')
  await tree.getByText('Development renamed', { exact: true }).waitFor()
  await w.screenshot({ path: path.join(evidence, 'dev-keyboard.png') })
  w.once('dialog', dialog => dialog.accept())
  await w.getByRole('button', { name: 'Delete Development renamed' }).click()
  await tree.getByText(/No collections yet/).waitFor()
  assert.deepEqual(consoleLines.filter(line => /^\[(error|warning|pageerror)\]/.test(line)), [])
  console.log('PASS npm run dev: keyboard create, input autofocus, Tab to Add, Enter submit, rename, delete, empty state; no captured renderer errors/warnings', dir)
} finally {
  if (browser) await browser.close()
  if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    if (child.exitCode === null) await new Promise(resolve => child.once('close', resolve))
  }
  fs.writeFileSync(path.join(evidence, 'dev-main.txt'), output)
  fs.writeFileSync(path.join(evidence, 'dev-renderer.txt'), consoleLines.join('\n') + '\n')
}
