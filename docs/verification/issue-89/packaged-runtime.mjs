// Offline package verification. Never contacts a model or uses subscription credentials.
// Run after npm run dist and extracting the archive. All state stays in artifactDir.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const artifactDir = resolve(process.argv[2] ?? 'test-artifacts/issue-89')
const packageRoot = resolve(process.argv[3] ?? join(artifactDir, 'extracted/vellum-0.1.0'))
const executablePath = join(packageRoot, 'vellum')
const realPdf = join(artifactDir, 'attention.pdf')
const screenshots = join(artifactDir, 'screenshots')
const bin = join(artifactDir, 'bin')
const config = join(artifactDir, 'config')
const launchOne = join(artifactDir, 'launch-one')
const launchTwo = join(artifactDir, 'launch-two')
const note = '# Packaged persistence\nAttention paper note survives restart from another launch directory.'
const question = 'Record an offline storage check for this paper.'
const reply = 'Offline fixture read the real paper.md; this reply checks persisted chat storage only.'
for (const directory of [screenshots, bin, launchOne, launchTwo]) mkdirSync(directory, { recursive: true })
assert(existsSync(executablePath), 'Extract npm run dist archive before running this script')
assert(existsSync(realPdf), 'Download https://arxiv.org/pdf/1706.03762 to artifactDir/attention.pdf')

// Metadata deliberately degrades. Chat exercises the real stdio wire with a local fixture.
writeFileSync(join(bin, 'claude-code-acp'), ['#!/usr/bin/env node', 'process.exit(127)', ''].join(String.fromCharCode(10)), { mode: 0o755 })
writeFileSync(join(bin, 'codex-acp'), `#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFileSync, appendFileSync } from 'node:fs'
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + String.fromCharCode(10))
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  } else if (message.method === 'session/new') {
    send({ id: message.id, result: { sessionId: 'offline-package-fixture' } })
  } else if (message.method === 'session/prompt') {
    const resource = message.params.prompt.find((block) => block.type === 'resource_link')
    const content = readFileSync(new URL(resource.uri), 'utf8')
    if (!/attention/i.test(content)) throw new Error('Expected real attention paper markdown')
    appendFileSync(process.env.ISSUE89_ACP_RECORD, JSON.stringify({ uri: resource.uri, characters: content.length }) + String.fromCharCode(10))
    setTimeout(() => {
      send({ method: 'session/update', params: { sessionId: message.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ${JSON.stringify(reply)} } } } })
      send({ id: message.id, result: { stopReason: 'end_turn' } })
    }, 100)
  }
})
`, { mode: 0o755 })

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '',
  ELECTRON_RENDERER_URL: '',
  VELLUM_DATA_DIR: '',
  VELLUM_DATA_ROOT: '',
  PATH: `${bin}:${process.env.PATH ?? ''}`,
  XDG_CONFIG_HOME: config,
  XDG_CACHE_HOME: join(artifactDir, 'cache'),
  ISSUE89_ACP_RECORD: join(artifactDir, 'fixture-reads.jsonl'),
}
const diagnostics = []
const runtime = {}

async function launch(name, options = {}) {
  console.log('Launching', name)
  const app = await electron.launch({ executablePath, args: ['--no-sandbox'], cwd: launchOne, env,
    timeout: 20_000, ...options })
  const mainLog = []
  app.process().stderr?.on('data', (chunk) => mainLog.push(String(chunk)))
  const window = await app.firstWindow()
  const renderer = []
  window.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) renderer.push(`[${message.type()}] ${message.text()}`)
  })
  window.on('pageerror', (error) => renderer.push(`[pageerror] ${error.message}`))
  diagnostics.push({ name, renderer, mainLog })
  await window.waitForLoadState('domcontentloaded')
  assert.equal(await window.evaluate(() => window.vellum.ping()), 'pong')
  if (name !== 'missing-native') await window.evaluate(() => window.vellum.listPapers())
  runtime[name] = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged,
    userData: app.getPath('userData'), cwd: process.cwd(), resourcesPath: process.resourcesPath,
    argv: process.argv, noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    processes: app.getAppMetrics().map(({ pid, type }) => ({ pid, type })) }))
  for (const child of runtime[name].processes) {
    try {
      child.argv = readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    } catch (error) {
      child.error = String(error)
    }
  }
  return { app, window }
}

async function waitForPdf(window) {
  await window.getByRole('main', { name: 'Paper view' }).locator('canvas').first().waitFor({ state: 'visible' })
  await window.waitForFunction(() => {
    const canvas = document.querySelector('main[aria-label="Paper view"] canvas')
    return canvas?.nextElementSibling?.textContent?.toLowerCase().includes('attention')
  })
  const rendered = await window.evaluate(() => {
    const canvas = document.querySelector('main[aria-label="Paper view"] canvas')
    if (!canvas || canvas.width < 100 || canvas.height < 100) return false
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 300) return true
    }
    return false
  })
  assert(rendered, 'Expected opaque text pixels in the rendered real PDF')
}

let current
try {
  current = await launch('packaged')
  let { window } = current
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByText('No papers yet — ingest one to get started.', { exact: true }).waitFor()
  assert.deepEqual(await window.evaluate(() => window.vellum.listPapers()), [])
  const dataRoot = join(runtime.packaged.userData, 'data')
  assert(existsSync(join(dataRoot, 'app.db')))
  assert(!existsSync(join(launchOne, 'data')))
  await window.screenshot({ path: join(screenshots, 'packaged-empty.png') })

  await window.getByRole('button', { name: 'Create', exact: true }).click()
  const input = window.getByLabel('Paper identifier or URL')
  assert(await input.evaluate((element) => document.activeElement === element))
  assert(await window.getByRole('button', { name: 'Add Paper', exact: true }).isDisabled())
  const invalidPdf = join(artifactDir, 'invalid.pdf')
  writeFileSync(invalidPdf, 'invalid PDF bytes')
  await input.fill(invalidPdf)
  await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await window.getByRole('dialog').getByRole('alert').waitFor()
  runtime.invalidPdfError = await window.getByRole('dialog').getByRole('alert').innerText()
  await input.fill(realPdf)
  await window.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await window.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60_000 })
  await waitForPdf(window)
  const papers = await window.evaluate(() => window.vellum.listPapers())
  assert.equal(papers.length, 1)
  const paper = papers[0]
  assert(existsSync(join(dataRoot, 'papers', paper.slug, 'paper.pdf')))
  assert.match(readFileSync(join(dataRoot, 'papers', paper.slug, 'paper.md'), 'utf8'), /attention/i)
  runtime.paper = { slug: paper.slug, title: paper.title, mdPath: paper.mdPath }

  await window.getByRole('tab', { name: 'Notes', exact: true }).click()
  const editor = window.getByRole('textbox', { name: 'Note', exact: true })
  await editor.click()
  await editor.pressSequentially(note)
  await window.getByText('Saved', { exact: true }).waitFor()
  assert.equal(await editor.inputValue(), note)
  await window.screenshot({ path: join(screenshots, 'packaged-note.png') })

  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await window.getByLabel('Model backend').selectOption('codex')
  const composer = window.getByRole('textbox', { name: 'Ask a question', exact: true })
  await composer.fill(question)
  await window.getByRole('button', { name: 'Send', exact: true }).click()
  await window.getByText(reply, { exact: true }).waitFor({ timeout: 20_000 })
  await window.waitForFunction(() => !document.querySelector('input[aria-label="Ask a question"]').disabled)
  await window.screenshot({ path: join(screenshots, 'packaged-chat.png') })
  await current.app.close()
  current = undefined

  current = await launch('restart', { cwd: launchTwo })
  window = current.window
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('list', { name: 'Papers' }).getByRole('button', { name: paper.title, exact: true }).click()
  await waitForPdf(window)
  await window.getByText(question, { exact: true }).waitFor()
  await window.getByText(reply, { exact: true }).waitFor()
  assert.equal(await window.getByLabel('Model backend').inputValue(), 'codex')
  await window.screenshot({ path: join(screenshots, 'packaged-restart.png') })
  await window.getByRole('tab', { name: 'Notes', exact: true }).click()
  await window.waitForFunction((expected) => document.querySelector('textarea[aria-label="Note"]')?.value === expected, note)
  assert(!existsSync(join(launchTwo, 'data')))
  await current.app.close()
  current = undefined
  runtime.persistence = 'Real PDF, markdown, note, user message and offline fixture reply survive restart from another cwd.'

  const override = join(artifactDir, 'override-data')
  current = await launch('override', { env: { ...env, XDG_CONFIG_HOME: join(artifactDir, 'override-config'), VELLUM_DATA_DIR: override } })
  assert.deepEqual(await current.window.evaluate(() => window.vellum.listPapers()), [])
  assert(existsSync(join(override, 'app.db')))
  assert(!existsSync(join(runtime.override.userData, 'data')))
  await current.app.close()
  current = undefined

  const sourceCwd = join(artifactDir, 'source-cwd')
  mkdirSync(sourceCwd, { recursive: true })
  current = await launch('source', { executablePath: resolve('node_modules/electron/dist/electron'),
    args: ['--no-sandbox', resolve('out/main/index.cjs')], cwd: sourceCwd,
    env: { ...env, XDG_CONFIG_HOME: join(artifactDir, 'source-config') } })
  assert.equal(runtime.source.isPackaged, false)
  assert.deepEqual(await current.window.evaluate(() => window.vellum.listPapers()), [])
  assert(existsSync(join(sourceCwd, 'data/app.db')))
  await current.app.close()
  current = undefined

  const native = join(packageRoot, 'resources/native/better_sqlite3.node')
  assert(existsSync(native))
  renameSync(native, `${native}.unavailable`)
  try {
    current = await launch('missing-native', { env: { ...env, XDG_CONFIG_HOME: join(artifactDir, 'missing-native-config') } })
    const error = await current.window.evaluate(async () => {
      try { await window.vellum.listPapers(); return '' }
      catch (error) { return String(error) }
    })
    assert(error.includes(native), `Missing binding must fail at explicit resource: ${error}`)
    runtime.missingNativeError = error
  } finally {
    if (current) await current.app.close()
    current = undefined
    renameSync(`${native}.unavailable`, native)
  }

  // Direct no-flag launch avoids Playwright's default --no-sandbox injection.
  // GNU timeout also cleans up descendants if another host permits startup.
  const sandbox = spawnSync('timeout', ['--kill-after=2s', '10s', executablePath], {
    cwd: launchOne, env: { ...env, XDG_CONFIG_HOME: join(artifactDir, 'sandbox-config') },
    encoding: 'utf8',
  })
  runtime.defaultSandbox = { verified: false, status: sandbox.status, signal: sandbox.signal,
    error: sandbox.error?.message, stdout: sandbox.stdout, stderr: sandbox.stderr }
  for (const entry of diagnostics.filter((entry) => entry.name !== 'missing-native')) {
    assert.deepEqual(entry.renderer, [], `Renderer errors/warnings in ${entry.name}`)
  }
  console.log(runtime.persistence)
  console.log('Preload, SQLite, userData, override, source cwd, and explicit missing-native checks passed.')
  console.log('Default sandbox remains unverified. Direct launch status:', sandbox.status, sandbox.signal)
} catch (error) {
  if (current) {
    await current.window.screenshot({ path: join(screenshots, 'failure.png') }).catch(() => undefined)
    const body = await current.window.locator('body').innerText().catch(() => '')
    writeFileSync(join(artifactDir, 'failure-dom.txt'), body)
  }
  throw error
} finally {
  if (current) await current.app.close()
  writeFileSync(join(artifactDir, 'runtime.json'), JSON.stringify(runtime, null, 2))
  writeFileSync(join(artifactDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
}
