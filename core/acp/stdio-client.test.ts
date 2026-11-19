// Tests for StdioAcpClient. Two layers:
//
// 1. `mapSessionUpdate` — pure function, no subprocess.
// 2. `StdioAcpClient` end-to-end over real stdio — but talking to a small
//    local ndjson JSON-RPC script (`FAKE_AGENT_SCRIPT` below) standing in for
//    `claude-code-acp` / `codex-acp`, injected via the `SpawnAdapter` seam.
//    This exercises the real transport (spawn, ndjson framing, JSON-RPC,
//    session/update routing) without requiring a live, signed-in adapter CLI
//    on PATH. See core/acp/README.md for the separate *live* smoke test.

import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import type { AcpBackend, AcpUpdate } from './client.js'
import {
  MAX_EMBEDDED_CONTEXT_BYTES,
  StdioAcpClient,
  buildAdapterArgs,
  buildAdapterEnv,
  describeSessionError,
  mapSessionUpdate,
  readEmbeddableContext,
  resolveAdapterCommand,
  toPromptBlocks,
  type SpawnAdapter,
} from './stdio-client.js'

type AdapterChildProcess = ChildProcessByStdio<Writable, Readable, null>

// A minimal ACP agent, speaking ndjson JSON-RPC over stdio, with no
// dependency on @agentclientprotocol/sdk (an independent wire-level double).
// Behavior is selected via argv so one script covers every test scenario.
const FAKE_AGENT_SCRIPT = String.raw`
const readline = require('node:readline')
const { spawn } = require('node:child_process')
// argv[0] is the node binary; with \`node -e <script> <extra>\`, the first
// extra arg lands at argv[1] (there is no "eval" placeholder entry).
const mode = process.argv[1]
// Session-mode behaviour of the double, chosen by a second argv entry:
//   (default)       starts in 'auto', offers default/read-only/auto/plan
//   start-safe      starts in 'default' (claude) already
//   no-modes        session/new returns no \`modes\` field at all
//   no-safe-mode    offers only auto and acceptEdits
//   set-fails       session/set_mode answers with a JSON-RPC error
//   drift-mid-turn  after a good handshake, session/prompt announces current_mode_update 'auto' and then stalls
//   drift-idle      answers the first prompt, then announces current_mode_update 'auto' with no turn in flight
//   set-ignored     session/set_mode succeeds but the agent announces it stayed in 'auto'
const modeVariant = process.argv[2] || ''
const setModeCalls = []
let currentMode = modeVariant === 'start-safe' ? 'default' : 'auto'

if (mode === 'exit-immediately') {
  process.exit(7)
}

if (mode === 'term-resistant-descendant') {
  spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

let sessionCwd = null
const permissionReplies = new Map()
let pendingPrompt = null
function finishPermissionProbe() {
  const summary = JSON.stringify({ cwd: sessionCwd, outcomes: Object.fromEntries(permissionReplies) })
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: summary } } },
  })
  send({ jsonrpc: '2.0', id: pendingPrompt, result: { stopReason: 'end_turn' } })
}

rl.on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method === undefined && typeof msg.id === 'string' && msg.id.startsWith('perm-')) {
    permissionReplies.set(msg.id.slice(5), msg.result.outcome)
    if (permissionReplies.size === 5) finishPermissionProbe()
    return
  }
  if (msg.method === 'initialize') {
    // 'stall-handshake' never answers initialize, simulating a hung adapter
    // before the handshake completes.
    if (mode === 'stall-handshake') return
    const agentCapabilities = mode.startsWith('embed') ? { promptCapabilities: { embeddedContext: true } } : {}
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities } })
  } else if (msg.method === 'session/new') {
    sessionCwd = msg.params.cwd
    const ids = modeVariant === 'no-safe-mode' ? ['auto', 'acceptEdits'] : ['default', 'read-only', 'auto', 'plan']
    const result = { sessionId: 'sess-1' }
    if (modeVariant !== 'no-modes') {
      result.modes = { currentModeId: currentMode, availableModes: ids.map((id) => ({ id, name: id })) }
    }
    send({ jsonrpc: '2.0', id: msg.id, result })
  } else if (msg.method === 'session/set_mode') {
    setModeCalls.push(msg.params.modeId)
    if (modeVariant === 'set-fails') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'mode not settable' } })
      return
    }
    if (modeVariant === 'set-ignored') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'current_mode_update', currentModeId: 'auto' } } })
    } else {
      currentMode = msg.params.modeId
    }
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
  } else if (msg.method === 'session/prompt') {
    if (modeVariant === 'drift-mid-turn') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'current_mode_update', currentModeId: 'auto' } } })
      return
    }
    if (modeVariant === 'drift-idle') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } } })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'current_mode_update', currentModeId: 'auto' } } })
      return
    }
    // 'modes-probe' reports what the client did to this session.
    if (mode === 'modes-probe') {
      const summary = JSON.stringify({
        cwd: sessionCwd,
        currentMode,
        setModeCalls,
        env: { INITIAL_AGENT_MODE: process.env.INITIAL_AGENT_MODE ?? null, CODEX_CONFIG: process.env.CODEX_CONFIG ?? null },
      })
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: summary } } } })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }
    // 'permission-probe' asks for permission on five tool kinds, then reports
    // the outcomes it received together with the cwd given to session/new.
    if (mode === 'permission-probe') {
      pendingPrompt = msg.id
      const options = [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ]
      for (const kind of ['read', 'search', 'execute', 'edit', 'fetch']) {
        send({
          jsonrpc: '2.0',
          id: 'perm-' + kind,
          method: 'session/request_permission',
          params: {
            sessionId: 'sess-1',
            toolCall: {
              toolCallId: 't-' + kind,
              title: kind,
              kind,
              // read/search are scoped to the session cwd, so they name a path inside it.
              ...(kind === 'read' ? { locations: [{ path: sessionCwd + '/paper.md' }] } : {}),
              ...(kind === 'search' ? { rawInput: { pattern: 'attention', path: sessionCwd } } : {}),
            },
            options,
          },
        })
      }
      return
    }
    // 'slow-stream' answers with chunks spaced 30ms apart (total ~180ms) so
    // a test can set an idle budget well under the total turn duration:
    // every gap stays under the idle bound while the total exceeds it.
    if (mode === 'slow-stream') {
      let i = 0
      const sendChunk = () => {
        i++
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: msg.params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'chunk-' + i } },
          },
        })
        if (i < 5) setTimeout(sendChunk, 30)
        else setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }), 30)
      }
      setTimeout(sendChunk, 30)
      return
    }
    // 'echo-stream' streams three chunks tagged with this prompt's own text,
    // spaced 30ms apart, so overlapping turns are distinguishable on the wire.
    if (mode === 'echo-stream') {
      const tag = msg.params.prompt[0].text
      let i = 0
      const sendChunk = () => {
        i++
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: msg.params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: tag + '-' + i } },
          },
        })
        if (i < 3) setTimeout(sendChunk, 30)
        else send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      }
      setTimeout(sendChunk, 30)
      return
    }
    // 'embed-echo' / 'link-echo' reply with a summary of the prompt blocks.
    if (mode === 'embed-echo' || mode === 'link-echo') {
      const summary = msg.params.prompt
        .map((b) => (b.type === 'resource' ? 'resource:' + b.resource.text : b.type))
        .join('|')
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: summary } },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }
    if (mode === 'prompt-error') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'boom' } })
      return
    }
    // 'stall' never answers session/prompt, simulating an adapter that hangs
    // mid-turn (e.g. an errored codex-acp turn, or any other stall).
    if (mode === 'stall') return
    // 'crash-mid-turn' accepts the prompt, then dies without answering it
    // (an adapter crash or OOM kill in the middle of a turn).
    if (mode === 'crash-mid-turn') process.exit(9)
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: msg.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
      },
    })
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
  }
})
`

function spawnFakeAgent(mode: string, variant = '', useAdapterEnv = false): SpawnAdapter {
  return (backend: AcpBackend): AdapterChildProcess =>
    spawn(process.execPath, ['-e', FAKE_AGENT_SCRIPT, mode, variant], {
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: process.platform !== 'win32',
      ...(useAdapterEnv ? { env: buildAdapterEnv(process.env, backend) } : {}),
    }) as AdapterChildProcess
}

async function collect(iter: AsyncIterable<AcpUpdate>): Promise<AcpUpdate[]> {
  const out: AcpUpdate[] = []
  for await (const update of iter) out.push(update)
  return out
}

describe('mapSessionUpdate', () => {
  it('maps agent_message_chunk to a text update', () => {
    const result = mapSessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
    } as never)
    expect(result).toEqual({ kind: 'text', data: { type: 'text', text: 'hi' } })
  })

  it('carries the agent message id so separate messages can be split', () => {
    const result = mapSessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
      messageId: 'm2',
    } as never)
    expect(result).toEqual({ kind: 'text', data: { type: 'text', text: 'hi' }, messageId: 'm2' })
  })

  it('keeps echoed user prompts and agent reasoning out of answer text', () => {
    for (const sessionUpdate of ['user_message_chunk', 'agent_thought_chunk']) {
      const raw = { sessionUpdate, content: { type: 'text', text: 'not the answer' } }
      expect(mapSessionUpdate(raw as never)).toEqual({ kind: 'tool_result', data: raw })
    }
  })

  it('maps tool_call to a tool_call update', () => {
    const raw = { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'grep' }
    expect(mapSessionUpdate(raw as never)).toEqual({ kind: 'tool_call', data: raw })
  })

  it('maps tool_call_update to a tool_result update', () => {
    const raw = { sessionUpdate: 'tool_call_update', toolCallId: 't1' }
    expect(mapSessionUpdate(raw as never)).toEqual({ kind: 'tool_result', data: raw })
  })

  it('maps usage_update to a usage_update update', () => {
    const raw = { sessionUpdate: 'usage_update', used: 1500, size: 200000 }
    expect(mapSessionUpdate(raw as never)).toEqual({ kind: 'usage_update', data: raw })
  })

  it('falls back to tool_result for update kinds with no dedicated AcpUpdate kind', () => {
    const raw = { sessionUpdate: 'plan', entries: [] }
    expect(mapSessionUpdate(raw as never)).toEqual({ kind: 'tool_result', data: raw })
  })
})

describe('StdioAcpClient permission policy and cwd', () => {
  async function probe(client: StdioAcpClient, cwd?: string): Promise<{ cwd: string; outcomes: Record<string, { outcome: string; optionId?: string }> }> {
    const session = await client.newSession('codex', cwd === undefined ? undefined : { cwd })
    try {
      const updates = await collect(session.prompt({ text: 'probe' }))
      const text = updates.filter((u) => u.kind === 'text').map((u) => (u.data as { text: string }).text).join('')
      return JSON.parse(text)
    } finally {
      await session.dispose()
    }
  }

  it('grants read-only tool kinds and rejects edit, execute and fetch', async () => {
    const log: Array<{ kind: string | undefined; decision: string }> = []
    const client = new StdioAcpClient(spawnFakeAgent('permission-probe'), {}, {
      onPermissionDecision: (entry) => log.push({ kind: entry.kind, decision: entry.decision }),
    })
    const result = await probe(client)
    expect(result.outcomes).toEqual({
      read: { outcome: 'selected', optionId: 'allow' },
      search: { outcome: 'selected', optionId: 'allow' },
      execute: { outcome: 'selected', optionId: 'reject' },
      edit: { outcome: 'selected', optionId: 'reject' },
      fetch: { outcome: 'selected', optionId: 'reject' },
    })
    expect(log.map((entry) => `${entry.kind}:${entry.decision}`).sort()).toEqual([
      'edit:reject', 'execute:reject', 'fetch:reject', 'read:allow', 'search:allow',
    ])
  })

  it('passes the requested cwd to session/new', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-cwd-'))
    try {
      const result = await probe(new StdioAcpClient(spawnFakeAgent('permission-probe'), {}, { onPermissionDecision: () => {} }), dir)
      expect(result.cwd).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses a private per-session temp dir when no cwd is given, and removes it on dispose', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('modes-probe'), {}, { onPermissionDecision: () => {} })
    const session = await client.newSession('codex')
    const updates = await collect(session.prompt({ text: 'probe' }))
    const { cwd } = JSON.parse(updates.filter((u) => u.kind === 'text').map((u) => (u.data as { text: string }).text).join(''))
    expect(cwd).not.toBe(process.cwd())
    expect(cwd).not.toBe(tmpdir())
    expect(cwd.startsWith(join(tmpdir(), 'vellum-session-'))).toBe(true)
    expect(statSync(cwd).mode & 0o777).toBe(0o700)
    await session.dispose()
    expect(existsSync(cwd)).toBe(false)
  })

  it('removes the private temp dir when the handshake fails', async () => {
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('vellum-session-')))
    const client = new StdioAcpClient(spawnFakeAgent('exit-immediately'), {}, { onPermissionDecision: () => {} })
    await expect(client.newSession('claude')).rejects.toThrow()
    const leaked = readdirSync(tmpdir()).filter((name) => name.startsWith('vellum-session-') && !before.has(name))
    expect(leaked).toEqual([])
  })
})

describe('StdioAcpClient session mode enforcement', () => {
  interface ModesReport {
    currentMode: string
    setModeCalls: string[]
    env: { INITIAL_AGENT_MODE: string | null; CODEX_CONFIG: string | null }
  }
  async function modes(backend: AcpBackend, variant = '', useAdapterEnv = false): Promise<ModesReport> {
    const client = new StdioAcpClient(spawnFakeAgent('modes-probe', variant, useAdapterEnv), {}, { onPermissionDecision: () => {} })
    const session = await client.newSession(backend, { cwd: tmpdir() })
    try {
      const updates = await collect(session.prompt({ text: 'probe' }))
      return JSON.parse(updates.filter((u) => u.kind === 'text').map((u) => (u.data as { text: string }).text).join(''))
    } finally {
      await session.dispose()
    }
  }

  it('moves a Claude session out of auto into default with session/set_mode', async () => {
    const report = await modes('claude')
    expect(report.setModeCalls).toEqual(['default'])
    expect(report.currentMode).toBe('default')
  })

  it('moves a Codex session into read-only with session/set_mode', async () => {
    const report = await modes('codex')
    expect(report.setModeCalls).toEqual(['read-only'])
    expect(report.currentMode).toBe('read-only')
  })

  it('does not call set_mode when the session already starts in the safe mode', async () => {
    expect((await modes('claude', 'start-safe')).setModeCalls).toEqual([])
  })

  it('starts the Codex adapter with INITIAL_AGENT_MODE=read-only and web search disabled', async () => {
    const report = await modes('codex', '', true)
    expect(report.env.INITIAL_AGENT_MODE).toBe('read-only')
    expect(JSON.parse(report.env.CODEX_CONFIG ?? '{}')).toMatchObject({ web_search: 'disabled', features: { apps: false, shell_tool: false, unified_exec: false } })
  })

  it('does not touch the mode of an Antigravity session', async () => {
    expect((await modes('antigravity')).setModeCalls).toEqual([])
  })

  it.each([
    ['no modes announced', 'no-modes', /does not offer the 'default' session mode/],
    ['safe mode not offered', 'no-safe-mode', /does not offer the 'default' session mode/],
    ['set_mode rejected', 'set-fails', /could not enter the 'default' session mode \(mode not settable\)/],
    ['agent stays in auto after set_mode', 'set-ignored', /stayed in the 'auto' session mode/],
  ])('fails closed and kills the adapter when %s', async (_name, variant, message) => {
    const children: AdapterChildProcess[] = []
    const spawnTracked: SpawnAdapter = (backend) => {
      const child = spawnFakeAgent('modes-probe', variant)(backend)
      children.push(child)
      return child
    }
    const client = new StdioAcpClient(spawnTracked, {}, { onPermissionDecision: () => {} })
    await expect(client.newSession('claude', { cwd: tmpdir() })).rejects.toThrow(message)
    expect(children).toHaveLength(1)
    expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true)
  })
})

describe('mode drift after the handshake', () => {
  function tracked(variant: string): { client: StdioAcpClient; children: AdapterChildProcess[] } {
    const children: AdapterChildProcess[] = []
    const spawnTracked: SpawnAdapter = (backend) => {
      const child = spawnFakeAgent('modes-probe', variant)(backend)
      children.push(child)
      return child
    }
    return { client: new StdioAcpClient(spawnTracked, {}, { onPermissionDecision: () => {} }), children }
  }
  const exited = async (child: AdapterChildProcess): Promise<boolean> => {
    for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await new Promise((r) => setTimeout(r, 100))
    return child.exitCode !== null || child.signalCode !== null
  }

  it('fails the in-flight turn, kills the adapter and fails later prompts when it leaves the safe mode', async () => {
    const { client, children } = tracked('drift-mid-turn')
    const session = await client.newSession('claude', { cwd: tmpdir() })
    const updates = await collect(session.prompt({ text: 'hi' }))
    expect(updates[0]).toMatchObject({ kind: 'error', data: { message: expect.stringMatching(/switched to the 'auto' session mode instead of 'default'/) } })
    expect(await exited(children[0]!)).toBe(true)
    const later = await collect(session.prompt({ text: 'again' }))
    expect(later[0]).toMatchObject({ kind: 'error', data: { message: expect.stringMatching(/switched to the 'auto'/) } })
    await session.dispose()
  })

  it('also catches a drift announced while no turn is in flight', async () => {
    const { client, children } = tracked('drift-idle')
    const session = await client.newSession('claude', { cwd: tmpdir() })
    const first = await collect(session.prompt({ text: 'hi' }))
    expect(first.at(-1)).toMatchObject({ kind: 'done' })
    expect(await exited(children[0]!)).toBe(true)
    const second = await collect(session.prompt({ text: 'again' }))
    expect(second[0]).toMatchObject({ kind: 'error', data: { message: expect.stringMatching(/switched to the 'auto'/) } })
    await session.dispose()
  })
})

describe('StdioAcpClient', () => {
  it('opens a session and streams updates ending in done', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('happy'))
    const session = await client.newSession('claude')
    try {
      const updates = await collect(session.prompt({ text: 'hi' }))
      expect(updates).toEqual([
        { kind: 'text', data: { type: 'text', text: 'hello' } },
        { kind: 'done', data: { stopReason: 'end_turn' } },
      ])
    } finally {
      await session.dispose()
    }
  })

  it('opens a session against a codex-flavored adapter identically', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('happy'))
    const session = await client.newSession('codex')
    try {
      const updates = await collect(session.prompt({ text: 'hi' }))
      expect(updates.at(-1)).toEqual({ kind: 'done', data: { stopReason: 'end_turn' } })
    } finally {
      await session.dispose()
    }
  })

  it('yields an error update when the adapter returns a JSON-RPC error for the prompt', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('prompt-error'))
    const session = await client.newSession('claude')
    try {
      const updates = await collect(session.prompt({ text: 'hi' }))
      expect(updates).toHaveLength(1)
      expect(updates[0]!.kind).toBe('error')
    } finally {
      await session.dispose()
    }
  })

  it('rejects newSession when the adapter process exits immediately (e.g. not installed)', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('exit-immediately'))
    await expect(client.newSession('claude')).rejects.toThrow(/exited with code 7/)
  })

  it('rejects newSession when the adapter binary does not exist', async () => {
    const spawnMissing: SpawnAdapter = () =>
      spawn('vellum-does-not-exist-acp', [], { stdio: ['pipe', 'pipe', 'inherit'] }) as AdapterChildProcess
    const client = new StdioAcpClient(spawnMissing)
    await expect(client.newSession('claude')).rejects.toThrow(/failed to spawn/)
  })

  it('dispose() kills the adapter subprocess and further prompt() calls error out', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('happy'))
    const session = await client.newSession('claude')
    await session.dispose()

    const updates = await collect(session.prompt({ text: 'hi after dispose' }))
    expect(updates).toEqual([{ kind: 'error', data: { message: 'session disposed' } }])
  })

  it('dispose() does not resolve until the adapter subprocess exits', async () => {
    let child: AdapterChildProcess | undefined
    const captureChild: SpawnAdapter = (backend) => {
      child = spawnFakeAgent('happy')(backend)
      return child
    }
    const client = new StdioAcpClient(captureChild)
    const session = await client.newSession('codex')

    await session.dispose()

    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true)
  })

  it.runIf(process.platform !== 'win32')(
    'dispose() removes a TERM-resistant adapter descendant and remains idempotent',
    async () => {
      let child: AdapterChildProcess | undefined
      const captureChild: SpawnAdapter = (backend) => {
        child = spawnFakeAgent('term-resistant-descendant')(backend)
        return child
      }
      const client = new StdioAcpClient(captureChild)
      const session = await client.newSession('codex')
      const groupId = child!.pid!

      await Promise.all([session.dispose(), session.dispose()])

      expect(() => process.kill(-groupId, 0)).toThrow()
    },
  )

  it('does NOT kill a productive turn whose total duration exceeds the idle budget', async () => {
    // Regression test for #71: a turn that keeps streaming (gaps of ~30ms,
    // total ~180ms) must survive an idle budget of 60ms. Under the old
    // total-duration cap this turn died at 60ms with 'ACP turn timed out'.
    const client = new StdioAcpClient(spawnFakeAgent('slow-stream'), { turnMs: 60 })
    const session = await client.newSession('claude')
    try {
      const updates = await collect(session.prompt({ text: 'hi' }))
      expect(updates.at(-1)).toEqual({ kind: 'done', data: { stopReason: 'end_turn' } })
      expect(updates.filter((u) => u.kind === 'text')).toHaveLength(5)
    } finally {
      await session.dispose()
    }
  })

  it('fails a stalled prompt() via the turn timeout instead of hanging forever', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('stall'), { turnMs: 50 })
    const session = await client.newSession('claude')
    try {
      const updates = await collect(session.prompt({ text: 'hi' }))
      expect(updates).toHaveLength(1)
      expect(updates[0]).toEqual({ kind: 'error', data: { message: 'ACP turn timed out after 50ms' } })
    } finally {
      await session.dispose()
    }
  })

  it('keeps overlapping prompt() calls on one session from stealing each other\'s updates', async () => {
    // A second Ask on the same paper can start while the first is still
    // streaming (e.g. the Ask panel remounts and re-enables its input). Each
    // turn must receive only its own updates and its own terminal `done`.
    const client = new StdioAcpClient(spawnFakeAgent('echo-stream'))
    const session = await client.newSession('codex')
    try {
      const first = collect(session.prompt({ text: 'first' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
      const second = collect(session.prompt({ text: 'second' }))
      const texts = (updates: AcpUpdate[]): string[] =>
        updates.filter((u) => u.kind === 'text').map((u) => (u.data as { text: string }).text)

      const [firstUpdates, secondUpdates] = await Promise.all([first, second])

      expect(texts(firstUpdates)).toEqual(['first-1', 'first-2', 'first-3'])
      expect(firstUpdates.at(-1)).toEqual({ kind: 'done', data: { stopReason: 'end_turn' } })
      expect(texts(secondUpdates)).toEqual(['second-1', 'second-2', 'second-3'])
      expect(secondUpdates.at(-1)).toEqual({ kind: 'done', data: { stopReason: 'end_turn' } })
    } finally {
      await session.dispose()
    }
  })

  it('does not let a queued prompt\'s idle timer run while an earlier turn is still streaming', async () => {
    // Idle budget 60ms; each turn streams for ~90ms with 30ms gaps. A second
    // turn waiting behind the first must not start its idle clock (and kill
    // the adapter) before it has actually been sent.
    const client = new StdioAcpClient(spawnFakeAgent('echo-stream'), { turnMs: 60 })
    const session = await client.newSession('codex')
    try {
      const [firstUpdates, secondUpdates] = await Promise.all([
        collect(session.prompt({ text: 'first' })),
        collect(session.prompt({ text: 'second' })),
      ])
      expect(firstUpdates.at(-1)).toEqual({ kind: 'done', data: { stopReason: 'end_turn' } })
      expect(secondUpdates.at(-1)).toEqual({ kind: 'done', data: { stopReason: 'end_turn' } })
    } finally {
      await session.dispose()
    }
  })

  it('releases a prompt queued behind a stalled turn when the session is disposed', async () => {
    const client = new StdioAcpClient(spawnFakeAgent('stall'), { turnMs: 30_000 })
    const session = await client.newSession('codex')
    const first = collect(session.prompt({ text: 'first' }))
    const second = collect(session.prompt({ text: 'second' }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    await session.dispose()

    expect(await second).toEqual([{ kind: 'error', data: { message: 'session disposed' } }])
    await first
  }, 10_000)

  it('ends an in-flight prompt() with an error, not a silent end, when the session is disposed mid-turn', async () => {
    // ChatManager treats an iterator that ends without `error` as a finished
    // turn and persists the partial text as the assistant reply. Disposal
    // mid-turn (New chat, paper removal, app shutdown) must say so.
    const client = new StdioAcpClient(spawnFakeAgent('stall'), { turnMs: 30_000 })
    const session = await client.newSession('codex')
    const updates = collect(session.prompt({ text: 'hi' }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    await session.dispose()

    expect(await updates).toEqual([{ kind: 'error', data: { message: 'session disposed' } }])
  }, 10_000)

  it('reports the adapter exit diagnostic when the adapter dies mid-turn', async () => {
    // Idle budget far above the test's patience: the error must come from
    // the child exiting, not from the idle timer eventually firing.
    const client = new StdioAcpClient(spawnFakeAgent('crash-mid-turn'), { turnMs: 30_000 })
    const session = await client.newSession('codex')
    try {
      const updates = await collect(session.prompt({ text: 'hi' }))
      expect(updates).toEqual([
        { kind: 'error', data: { message: "ACP adapter 'codex-acp' exited with code 9" } },
      ])
    } finally {
      await session.dispose()
    }
  }, 10_000)

  it('fails newSession() via the handshake timeout when the adapter never answers initialize', async () => {
    let child: AdapterChildProcess | undefined
    const captureChild: SpawnAdapter = (backend) => {
      child = spawnFakeAgent('stall-handshake')(backend)
      return child
    }
    const client = new StdioAcpClient(captureChild, { handshakeMs: 50 })
    await expect(client.newSession('claude')).rejects.toThrow('ACP handshake timed out after 50ms')
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true)
  })
})

describe('paper context embedding (#101)', () => {
  const text = (updates: AcpUpdate[]): string =>
    updates.map((u) => (u.kind === 'text' ? (u.data as { text: string }).text : '')).join('')

  it('embeds a context file once per session when the agent accepts embedded context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-embed-'))
    const md = join(dir, 'paper.md')
    writeFileSync(md, '# Paper body')
    const client = new StdioAcpClient(spawnFakeAgent('embed-echo'))
    const session = await client.newSession('codex')
    try {
      expect(text(await collect(session.prompt({ text: 'q1', contextFiles: [md] })))).toBe('text|resource:# Paper body')
      expect(text(await collect(session.prompt({ text: 'q2', contextFiles: [md] })))).toBe('text|resource_link')
    } finally {
      await session.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('only links context files when the agent does not accept embedded context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-embed-'))
    const md = join(dir, 'paper.md')
    writeFileSync(md, '# Paper body')
    const client = new StdioAcpClient(spawnFakeAgent('link-echo'))
    const session = await client.newSession('codex')
    try {
      expect(text(await collect(session.prompt({ text: 'q1', contextFiles: [md] })))).toBe('text|resource_link')
    } finally {
      await session.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('links instead of embedding missing or oversized files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vellum-embed-'))
    try {
      const big = join(dir, 'big.md')
      writeFileSync(big, 'x'.repeat(MAX_EMBEDDED_CONTEXT_BYTES + 1))
      expect(readEmbeddableContext(big)).toBeNull()
      expect(readEmbeddableContext(join(dir, 'missing.md'))).toBeNull()
      expect(readEmbeddableContext(dir)).toBeNull()
      const blocks = toPromptBlocks({ text: 'q', contextFiles: [big] }, readEmbeddableContext)
      expect(blocks.map((b) => b.type)).toEqual(['text', 'resource_link'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('buildAdapterEnv', () => {
  it('delivers a trimmed Codex model and existing config to a real subprocess without mutating source', () => {
    const sourceEnv = Object.freeze({
      VELLUM_CODEX_MODEL: '  model "quoted" \n name  ',
      CODEX_CONFIG: '{"model":"old","service_tier":"default","nested":{"keep":true}}',
    })
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.CODEX_CONFIG)'], {
      env: buildAdapterEnv(sourceEnv, 'codex'),
      encoding: 'utf8',
    })
    expect(child.status).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({
      model: 'model "quoted" \n name',
      service_tier: 'default',
      nested: { keep: true },
      web_search: 'disabled',
      features: { apps: false, shell_tool: false, unified_exec: false },
    })
    expect(sourceEnv.CODEX_CONFIG).toBe('{"model":"old","service_tier":"default","nested":{"keep":true}}')
  })

  it('creates Codex config when absent without introducing unrelated defaults', () => {
    const sourceEnv = Object.freeze({ VELLUM_CODEX_MODEL: '  gpt-6.1-sol  ' })
    expect(buildAdapterEnv(sourceEnv, 'codex')).toEqual({
      ...sourceEnv,
      CODEX_CONFIG: '{"model":"gpt-6.1-sol","web_search":"disabled","features":{"apps":false,"shell_tool":false,"unified_exec":false}}',
      INITIAL_AGENT_MODE: 'read-only',
    })
    expect(sourceEnv).not.toHaveProperty('CODEX_CONFIG')
  })

  it.each([undefined, '', ' \n '])('adds only Vellum session limits to Codex config with no model override (%j)', (model) => {
    const sourceEnv = { VELLUM_CODEX_MODEL: model, CODEX_CONFIG: '{"service_tier":"default"}' }
    const env = buildAdapterEnv(sourceEnv, 'codex')
    expect(JSON.parse(env.CODEX_CONFIG ?? '')).toEqual({ service_tier: 'default', web_search: 'disabled', features: { apps: false, shell_tool: false, unified_exec: false } })
    expect(env.INITIAL_AGENT_MODE).toBe('read-only')
    expect(buildAdapterArgs('codex', sourceEnv)).toEqual([])
  })

  it('forces web search off and read-only mode over contrary user settings', () => {
    const env = buildAdapterEnv(
      { INITIAL_AGENT_MODE: 'agent-full-access', CODEX_CONFIG: '{"web_search":"live","model":"m","features":{"apps":true,"keep":true}}' },
      'codex',
    )
    expect(env.INITIAL_AGENT_MODE).toBe('read-only')
    expect(JSON.parse(env.CODEX_CONFIG ?? '')).toEqual({ model: 'm', web_search: 'disabled', features: { apps: false, shell_tool: false, unified_exec: false, keep: true } })
  })

  it('rejects invalid config without a model override using a fixed message', () => {
    expect(() => buildAdapterEnv({ CODEX_CONFIG: '{"secret":"do-not-echo"' }, 'codex')).toThrow(
      'Cannot apply Vellum Codex session limits: CODEX_CONFIG must be a JSON object',
    )
  })

  it.each(['{"secret":"do-not-echo"', 'null', '[]', '"do-not-echo"', '42', 'true', ''])(
    'rejects invalid config safely when merging (%j)',
    (config) => {
      const sourceEnv = Object.freeze({ VELLUM_CODEX_MODEL: 'gpt-6.1-sol', CODEX_CONFIG: config })
      let error: unknown
      try {
        buildAdapterEnv(sourceEnv, 'codex')
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) throw new Error('Expected a config validation error')
      expect(error.message).toBe(
        'Cannot apply VELLUM_CODEX_MODEL: CODEX_CONFIG must be a JSON object',
      )
      expect(error).not.toHaveProperty('cause')
      expect(sourceEnv.CODEX_CONFIG).toBe(config)
    },
  )

  it('leaves Claude config untouched even with a model override and invalid JSON', () => {
    const sourceEnv = Object.freeze({ VELLUM_CODEX_MODEL: 'gpt-6.1-sol', CODEX_CONFIG: 'invalid' })
    expect(buildAdapterEnv(sourceEnv, 'claude')).toEqual(sourceEnv)
    expect(buildAdapterArgs('claude', sourceEnv)).toEqual([])
  })

  it('strips CLAUDECODE and CLAUDE_CODE_SSE_PORT from the adapter child env', () => {
    const sourceEnv = {
      CLAUDECODE: '1',
      CLAUDE_CODE_SSE_PORT: '54321',
      PATH: '/usr/bin',
      HOME: '/home/vellum',
    }
    const result = buildAdapterEnv(sourceEnv)
    expect(result).not.toHaveProperty('CLAUDECODE')
    expect(result).not.toHaveProperty('CLAUDE_CODE_SSE_PORT')
    expect(result).toEqual({ PATH: '/usr/bin', HOME: '/home/vellum' })
  })

  it('leaves the env untouched when CLAUDECODE / CLAUDE_CODE_SSE_PORT are absent', () => {
    const sourceEnv = { PATH: '/usr/bin' }
    expect(buildAdapterEnv(sourceEnv)).toEqual({ PATH: '/usr/bin' })
  })
})

describe('buildAdapterArgs', () => {
  it('passes an explicit Codex model override through legacy adapter argv', () => {
    expect(buildAdapterArgs('codex', { VELLUM_CODEX_MODEL: 'gpt-5.5' })).toEqual([
      '-c',
      'model="gpt-5.5"',
    ])
  })

  it('uses normal adapter configuration when no Codex model override is set', () => {
    expect(buildAdapterArgs('codex', {})).toEqual([])
    expect(buildAdapterArgs('claude', { VELLUM_CODEX_MODEL: 'gpt-5.5' })).toEqual([])
  })
})

describe('antigravity backend', () => {
  it('starts agy as an ACP stdio server with its own app-data dir', () => {
    expect(buildAdapterArgs('antigravity', {})).toEqual(['acp', '--app-data-dir', 'antigravity-acp'])
  })

  it('strips raw Google API keys and cloud credentials so auth comes from agy sign-in', () => {
    const env = buildAdapterEnv(
      { PATH: '/usr/bin', GEMINI_API_KEY: 'k', GOOGLE_API_KEY: 'k', GOOGLE_APPLICATION_CREDENTIALS: '/x.json' },
      'antigravity',
    )
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('strips raw Anthropic and OpenAI API keys for every backend', () => {
    const keys = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 't', OPENAI_API_KEY: 'o', CODEX_API_KEY: 'c' }
    for (const backend of ['claude', 'codex', 'antigravity'] as const) {
      const env = buildAdapterEnv({ PATH: '/usr/bin', ...keys }, backend)
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
      expect(env).not.toHaveProperty('OPENAI_API_KEY')
      expect(env.PATH).toBe('/usr/bin')
    }
  })

  it('prefers claude-agent-acp on PATH and falls back to legacy claude-code-acp', () => {
    expect(resolveAdapterCommand('claude', { PATH: '/a:/b' }, (f) => f === '/b/claude-agent-acp')).toBe('claude-agent-acp')
    expect(resolveAdapterCommand('claude', { PATH: '/a:/b' }, () => false)).toBe('claude-code-acp')
  })

  it('leaves Google env alone for other backends', () => {
    expect(buildAdapterEnv({ GEMINI_API_KEY: 'k' }, 'codex')).toMatchObject({ GEMINI_API_KEY: 'k' })
  })

  it('resolves agy from VELLUM_AGY_PATH, then PATH, then ~/.local/bin', () => {
    const none = (): boolean => false
    expect(resolveAdapterCommand('antigravity', { VELLUM_AGY_PATH: '/opt/agy' }, none)).toBe('/opt/agy')
    expect(resolveAdapterCommand('antigravity', { PATH: '/a:/b', HOME: '/h' }, (f) => f === '/b/agy')).toBe('agy')
    expect(resolveAdapterCommand('antigravity', { PATH: '/a', HOME: '/h' }, (f) => f === '/h/.local/bin/agy')).toBe(
      '/h/.local/bin/agy',
    )
    expect(resolveAdapterCommand('antigravity', { PATH: '/a', HOME: '/h' }, none)).toBe('agy')
    expect(resolveAdapterCommand('codex', { VELLUM_AGY_PATH: '/opt/agy' }, none)).toBe('codex-acp')
  })

  it('maps ACP auth-required errors to a sign-in instruction', () => {
    expect(describeSessionError('antigravity', { code: -32000, message: 'Authentication required' })?.message).toMatch(
      /agy acp --login/,
    )
    expect(describeSessionError('antigravity', new Error('boom'))).toBeUndefined()
  })
})
