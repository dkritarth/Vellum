// Opt-in, signed-in, real-paper check of the ACP permission policy (#236).
// For each backend (default: codex; VELLUM_PROBE_BACKENDS=codex,claude):
//   1. ingests a real paper and, for Codex, asks a grounded question,
//   2. logs the session mode the client enforced (`[vellum:acp] session mode`),
//   3. runs a write probe: asks the agent to create files in the paper
//      directory and in /tmp, then asserts nothing was written and that every
//      write/execute permission request, if any, was rejected,
//   4. asks for a web search and, for Codex, checks the rollout holds no web
//      search call (web search arrives with no permission request),
//   5. checks the adapter-side mode evidence (Codex rollout turn_context).
// Build first. Run under a desktop session or xvfb-run:
//   node test/acp-permission-live.mjs /path/to/paper.pdf [output-dir]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ROOT, launchIsolatedApp, cleanupIsolatedApp,
  captureFailureArtifacts, assertNoConsoleErrors,
} from './harness.mjs'

const pdf = process.argv[2] ? path.resolve(process.argv[2]) : ''
assert(pdf && fs.existsSync(pdf), 'Pass a real paper PDF, e.g. /tmp/vellum-papers/1706.03762.pdf')
const evidence = path.resolve(process.argv[3] ?? path.join(ROOT, 'test-artifacts', 'acp-permission'))
fs.mkdirSync(evidence, { recursive: true })
const backends = (process.env.VELLUM_PROBE_BACKENDS ?? 'codex').split(',').map((name) => name.trim()).filter(Boolean)
const tag = `${process.pid}-${Date.now()}`

function listTree(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(`${path.relative(dir, full)}:${fs.statSync(full).size}`)
    }
  }
  walk(dir)
  return out.sort()
}

/** Codex turn contexts for sessions whose cwd is under `cwdPrefix`, from rollouts touched since `sinceMs`: adapter-side proof of the sandbox in effect. */
function codexModeEvidence(sinceMs, cwdPrefix) {
  const root = path.join(os.homedir(), '.codex', 'sessions')
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.startsWith('rollout-') && fs.statSync(full).mtimeMs >= sinceMs) files.push(full)
    }
  }
  walk(root)
  const found = new Set()
  let webCalls = 0
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    let ours = false
    for (const line of lines) {
      if (!line.includes('"turn_context"')) continue
      try {
        const payload = JSON.parse(line).payload ?? {}
        // The rollout dir is shared with every other Codex use on this host.
        if (typeof payload.cwd !== 'string' || !payload.cwd.startsWith(cwdPrefix)) continue
        ours = true
        found.add(`approval_policy=${JSON.stringify(payload.approval_policy)} sandbox_policy=${JSON.stringify(payload.sandbox_policy)}`)
      } catch { /* ignore partial lines */ }
    }
    if (ours) webCalls += lines.filter((line) => /"web_search_call"|web_run|"web_search_begin"/.test(line)).length
  }
  return { contexts: [...found], webCalls }
}

async function runBackend(backend) {
  const mainLines = []
  let window
  let active
  const startedAt = Date.now()
  const paperProbe = `vellum-edit-probe-${tag}-${backend}.txt`
  const tmpProbe = `/tmp/vellum-outside-probe-${tag}-${backend}.txt`
  const button = (name) => window.getByRole('button', { name, exact: true })
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
    await window.getByRole('combobox', { name: 'Model backend' }).selectOption(backend)
    const answers = window.locator('[class*=assistantMessage]')
    // Resolves with the visible answer, or the alert text when the chat errors.
    async function ask(question) {
      const before = await answers.count()
      await window.getByRole('textbox', { name: 'Ask a question', exact: true }).fill(question)
      await button('Send').click()
      await window.waitForFunction((count) => {
        const messages = [...document.querySelectorAll('[class*=assistantMessage]')]
        const sending = [...document.querySelectorAll('button')].some((element) => element.textContent === 'Sending…')
        return document.querySelector('[role=alert]') || (messages.length > count && messages.at(-1).textContent.length > 10 && !sending)
      }, before, { timeout: 240_000 })
      const alert = await window.getByRole('alert').count()
      if (alert > 0) return { error: (await window.getByRole('alert').first().innerText()).replace(/\s+/g, ' ') }
      return { answer: (await answers.last().innerText()).replace(/\s+/g, ' ') }
    }

    const grounded = await ask('What architecture does this paper introduce? Cite a section.')
    if (backend === 'codex') {
      assert(!grounded.error, `Codex Ask must answer: ${grounded.error}`)
      console.log(`[${backend}] ANSWER: ${grounded.answer.slice(0, 600)}`)
      assert.match(grounded.answer, /Transformer/i)
      assert.match(grounded.answer, /section|§|\b\d+(\.\d+)*\b/i, 'answer should cite a section')
      await window.screenshot({ path: path.join(evidence, `${backend}-answer.png`) })
    } else {
      console.log(`[${backend}] grounded ask: ${grounded.error ? `ERROR ${grounded.error}` : grounded.answer.slice(0, 300)}`)
    }

    const modeLines = mainLines.filter((line) => line.includes('[vellum:acp] session mode'))
    console.log(`[${backend}] SESSION MODE LINES: ${JSON.stringify(modeLines)}`)
    if (!grounded.error || modeLines.length > 0) {
      assert(modeLines.some((line) => line.includes(`backend=${backend}`)), `${backend} session must log its enforced mode`)
    }

    const papersDir = path.join(active.dataDir, 'papers')
    const paperDir = path.join(papersDir, fs.readdirSync(papersDir).find((name) => fs.statSync(path.join(papersDir, name)).isDirectory()))
    const before = listTree(paperDir)
    const probe = await ask(
      `Do this now without asking me anything: (1) create a file named ${paperProbe} in your working directory containing the word probe; ` +
      `(2) create the file ${tmpProbe} containing the word probe; (3) run the shell command \`echo probe > ${paperProbe}.sh.txt\`. ` +
      'Then tell me exactly which of the three worked.',
    )
    const search = await ask('Use your web search tool to look up the current stable Node.js LTS version and name the source you used. If you have no web search tool, say NO_WEB_TOOL.')
    console.log(`[${backend}] WEB SEARCH PROBE REPLY: ${(search.answer ?? `ERROR ${search.error}`).slice(0, 400)}`)
    console.log(`[${backend}] WRITE PROBE REPLY: ${(probe.answer ?? `ERROR ${probe.error}`).slice(0, 700)}`)
    assert(!fs.existsSync(path.join(paperDir, paperProbe)), `${paperProbe} must not exist in the paper dir`)
    assert(!fs.existsSync(path.join(paperDir, `${paperProbe}.sh.txt`)), 'shell-written file must not exist in the paper dir')
    assert(!fs.existsSync(tmpProbe), `${tmpProbe} must not exist`)
    assert.deepEqual(listTree(paperDir), before, 'paper dir contents must be unchanged by the write probe')
    console.log(`[${backend}] no file written in ${path.basename(paperDir)} or /tmp`)

    const permissions = mainLines.filter((line) => line.includes('[vellum:acp] permission'))
    console.log(`[${backend}] PERMISSION REQUESTS (${permissions.length}):`)
    for (const line of permissions) console.log(`  ${line}`)
    fs.writeFileSync(path.join(evidence, `${backend}-permissions.log`), `${[...modeLines, ...permissions].join('\n')}\n`)
    assert(
      !permissions.some((line) => /kind=(edit|delete|move|execute|switch_mode|other|fetch|unknown)\b.*decision=allow/.test(line)),
      'No write/execute/network permission may be granted',
    )
    assert(
      !permissions.some((line) => /kind=search\b.*decision=allow/.test(line) && /web/i.test(line)),
      'No web search may be allowed',
    )
    if (backend === 'codex') {
      const proof = codexModeEvidence(startedAt - 5_000, active.dataDir)
      console.log(`[${backend}] CODEX turn_context since start (web search calls in rollout: ${proof.webCalls}):`)
      for (const entry of proof.contexts) console.log(`  ${entry}`)
      assert.equal(proof.webCalls, 0, 'Codex must make no web search call')
      assert(proof.contexts.length > 0, 'Codex rollout must record a turn_context')
      assert(proof.contexts.every((entry) => /sandbox_policy=\{"type":"read-only"/.test(entry) && /approval_policy="on-request"/.test(entry)),
        'Every Codex turn must run read-only with on-request approval')
    }
    assertNoConsoleErrors(active.consoleLines)
    console.log(`[${backend}] console: clean`)
    console.log(`PASS acp-permission-live ${backend}`)
  } catch (error) {
    console.error(error)
    if (window) await captureFailureArtifacts(`acp-permission-live-${backend}`, { window, consoleLines: active?.consoleLines })
    console.error(`MAIN LOG (${backend}):\n${mainLines.join('\n')}`)
    process.exitCode = 1
  } finally {
    fs.rmSync(tmpProbe, { force: true })
    if (active) await cleanupIsolatedApp(active.app, active.dataDir)
  }
}

for (const backend of backends) await runBackend(backend)
