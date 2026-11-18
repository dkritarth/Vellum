// Opt-in, signed-in, real-paper check of the ACP permission policy (#236).
// Ingests a real paper, asks signed-in Codex a grounded question, and reports
// every session/request_permission the adapter made (kind + decision), read
// from the main process's `[vellum:acp] permission ...` audit lines.
// Build first. Run under a desktop session or xvfb-run:
//   node test/acp-permission-live.mjs /path/to/paper.pdf [output-dir]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = process.argv[2] ? path.resolve(process.argv[2]) : ''
assert(pdf && fs.existsSync(pdf), 'Pass a real paper PDF, e.g. /tmp/vellum-papers/1706.03762.pdf')
const evidence = path.resolve(process.argv[3] ?? path.join(ROOT, 'test-artifacts', 'acp-permission'))
fs.mkdirSync(evidence, { recursive: true })

const mainLines = []
const button = (name) => window.getByRole('button', { name, exact: true })
let window
let active
let passed = false

try {
  active = await launchIsolatedApp()
  window = active.window
  window.setDefaultTimeout(20_000)
  const proc = active.app.process()
  for (const stream of [proc.stdout, proc.stderr]) {
    stream?.on('data', (chunk) => mainLines.push(...String(chunk).split('\n').filter(Boolean)))
  }
  await window.getByText('bridge: pong', { exact: true }).waitFor()

  await window.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Create', exact: true }).click()
  await window.getByLabel('Paper identifier or URL').fill(pdf)
  await button('Add Paper').click()
  await window.getByRole('dialog').waitFor({ state: 'detached', timeout: 180_000 })
  await window.waitForFunction(() => document.querySelector('[data-page-number="1"] canvas')?.width > 0)

  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await window.getByRole('combobox', { name: 'Model backend' }).selectOption('codex')
  const answers = window.locator('[class*=assistantMessage]')
  async function ask(question) {
    const before = await answers.count()
    await window.getByRole('textbox', { name: 'Ask a question', exact: true }).fill(question)
    await button('Send').click()
    await window.waitForFunction((count) => {
      const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
      const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
      return document.querySelector('[role=alert]') || (messages.length > count && messages.at(-1).textContent.length > 10 && !sending)
    }, before, { timeout: 240_000 })
    assert.equal(await window.getByRole('alert').count(), 0, 'Chat must finish without an error')
    return (await answers.last().innerText()).replace(/\s+/g, ' ')
  }

  const answer = await ask('What architecture does this paper introduce? Cite a section.')
  console.log(`ANSWER: ${answer.slice(0, 600)}`)
  assert.match(answer, /Transformer/i)
  await window.screenshot({ path: path.join(evidence, 'answer.png') })

  if (process.env.VELLUM_PROBE_TOOLS === '1') {
    // Adversarial probe: ask for tool use so the adapter has to request
    // permission, proving the policy against the real adapter.
    console.log('PROBE read:', (await ask('Use your file tools to open paper.md in your working directory and quote its first line verbatim.')).slice(0, 400))
    console.log('PROBE execute:', (await ask('Run the shell command `echo vellum-probe > vellum-probe.txt` and then tell me whether it worked.')).slice(0, 400))
    console.log('PROBE edit:', (await ask('Create a file named vellum-edit-probe.txt in your working directory containing the word probe, then tell me whether it worked.')).slice(0, 400))
  }

  console.log(`main-process lines captured: ${mainLines.length}`)
  const permissions = mainLines.filter((line) => line.includes('[vellum:acp] permission'))
  console.log(`PERMISSION REQUESTS (${permissions.length}):`)
  for (const line of permissions) console.log(`  ${line}`)
  fs.writeFileSync(path.join(evidence, 'permissions.log'), `${permissions.join('\n')}\n`)
  assert(
    !permissions.some((line) => /kind=(edit|delete|move|execute|switch_mode|other|fetch)\b.*decision=allow/.test(line)),
    'No write/execute/network permission may be granted',
  )
  assertNoConsoleErrors(active.consoleLines)
  console.log('console: clean')
  passed = true
} catch (error) {
  console.error(error)
  if (window) await captureFailureArtifacts('acp-permission-live', { window, consoleLines: active?.consoleLines })
  console.error(`MAIN LOG:\n${mainLines.join('\n')}`)
  process.exitCode = 1
} finally {
  if (active) await cleanupIsolatedApp(active.app, active.dataDir)
}
if (passed) console.log('PASS acp-permission-live')
