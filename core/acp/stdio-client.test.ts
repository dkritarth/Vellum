// Tests for StdioAcpClient. Two layers:
//
// 1. `mapSessionUpdate` — pure function, no subprocess.
// 2. `StdioAcpClient` end-to-end over real stdio — but talking to a small
//    local ndjson JSON-RPC script (`FAKE_AGENT_SCRIPT` below) standing in for
//    `claude-code-acp` / `codex-acp`, injected via the `SpawnAdapter` seam.
//    This exercises the real transport (spawn, ndjson framing, JSON-RPC,
//    session/update routing) without requiring a live, signed-in adapter CLI
//    on PATH. See core/acp/README.md for the separate *live* smoke test.

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import type { AcpBackend, AcpUpdate } from './client.js'
import {
  StdioAcpClient,
  buildAdapterArgs,
  buildAdapterEnv,
  mapSessionUpdate,
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

rl.on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') {
    // 'stall-handshake' never answers initialize, simulating a hung adapter
    // before the handshake completes.
    if (mode === 'stall-handshake') return
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  } else if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-1' } })
  } else if (msg.method === 'session/prompt') {
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
    if (mode === 'prompt-error') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'boom' } })
      return
    }
    // 'stall' never answers session/prompt, simulating an adapter that hangs
    // mid-turn (e.g. an errored codex-acp turn, or any other stall).
    if (mode === 'stall') return
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

function spawnFakeAgent(mode: string): SpawnAdapter {
  return (_backend: AcpBackend): AdapterChildProcess =>
    spawn(process.execPath, ['-e', FAKE_AGENT_SCRIPT, mode], {
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: process.platform !== 'win32',
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

describe('buildAdapterEnv', () => {
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
  it('passes an explicit Codex model override through the first-party adapter config interface', () => {
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
