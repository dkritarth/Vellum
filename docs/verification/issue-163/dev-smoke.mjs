// Isolated npm run dev smoke. Production live.mjs covers fault injection.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { assertNoConsoleErrors } from '../../../test/harness.mjs'
const paper = path.resolve(process.argv[2])
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-163-dev-'))
const bin = path.join(root, 'bin')
fs.mkdirSync(bin)
for (const adapter of ['codex-acp', 'claude-code-acp']) fs.writeFileSync(path.join(bin, adapter), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
const child = spawn('npm', ['run', 'dev', '--', '--noSandbox', '--remoteDebuggingPort', '19363'], {
  detached: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PATH: `${bin}:${process.env.PATH}`, VELLUM_DATA_DIR: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let processLog = ''
child.stdout.on('data', (chunk) => { processLog += chunk })
child.stderr.on('data', (chunk) => { processLog += chunk })
let browser
const consoleLines = []
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(processLog)), 30000)
    const check = () => {
      const match = processLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); child.stdout.off('data', check); child.stderr.off('data', check); resolve(match[1]) }
    }
    child.stdout.on('data', check); child.stderr.on('data', check)
  })
  browser = await chromium.connectOverCDP(endpoint)
  const page = browser.contexts()[0].pages()[0]
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.stack}`))
  await page.waitForSelector('footer:has-text("bridge: pong")')
  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  await page.getByText('Open a paper to add notes.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('textbox', { name: 'Paper identifier or URL' }).fill(paper)
  await page.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 0 && !document.querySelector('textarea[aria-label="Note"]')?.disabled)
  const editor = page.getByRole('textbox', { name: 'Note', exact: true })
  await editor.fill('Development live note')
  await page.getByText('Saved', { exact: true }).waitFor()
  assert(await editor.evaluate((el) => el === document.activeElement))
  await page.getByRole('button', { name: 'Clear note' }).click()
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value === '')
  assert(await page.getByRole('button', { name: 'Clear note' }).isDisabled())
  assertNoConsoleErrors(consoleLines)
  console.log('PASS isolated npm run dev: visible real-paper ingestion, empty Notes, keyboard focus, save, Clear, clean renderer console')
} finally {
  if (browser) await browser.close()
  process.kill(-child.pid, 'SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
  fs.writeFileSync(new URL('./dev-console.log', import.meta.url), consoleLines.join('\n') + '\n')
  fs.writeFileSync(new URL('./dev-process.log', import.meta.url), processLog)
  console.log(`Isolated development data: ${root}`)
}
