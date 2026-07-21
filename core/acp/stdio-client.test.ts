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
import { StdioAcpClient, mapSessionUpdate, type SpawnAdapter } from './stdio-client.js'

type AdapterChildProcess = ChildProcessByStdio<Writable, Readable, null>

// A minimal ACP agent, speaking ndjson JSON-RPC over stdio, with no
// dependency on @agentclientprotocol/sdk (an independent wire-level double).
// Behavior is selected via argv so one script covers every test scenario.
const FAKE_AGENT_SCRIPT = String.raw`
const readline = require('node:readline')
// argv[0] is the node binary; with \`node -e <script> <extra>\`, the first
// extra arg lands at argv[1] (there is no "eval" placeholder entry).
const mode = process.argv[1]

if (mode === 'exit-immediately') {
  process.exit(7)
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  } else if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-1' } })
  } else if (msg.method === 'session/prompt') {
    if (mode === 'prompt-error') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'boom' } })
      return
    }
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
})
