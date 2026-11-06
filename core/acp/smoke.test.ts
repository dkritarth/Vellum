import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcpClient, AcpSession, AcpUpdate } from './client.js'
import { main } from './smoke.js'

const done: AcpUpdate = { kind: 'done', data: { stopReason: 'end_turn' } }
const text = (value: string): AcpUpdate => ({ kind: 'text', data: { text: value } })
const originalExitCode = process.exitCode

function adapter(updates: AcpUpdate[]) {
  const session: AcpSession = {
    prompt: vi.fn(async function* () { yield* updates }),
    dispose: vi.fn(async () => {}),
  }
  const client: AcpClient = { newSession: vi.fn(async () => session) }
  return { client, session }
}

function output(): string {
  return vi.mocked(console.log).mock.calls.map((args) => args.join(' ')).join('\n')
}

describe('ACP smoke CLI verdict', () => {
  beforeEach(() => {
    process.exitCode = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('rejects routing/authentication diagnostics followed by done', async () => {
    const { client, session } = adapter([
      text('WebSocket fallback; workspace routing discovery unauthorized (401)'), done,
    ])
    await main(['codex'], client)
    expect(process.exitCode).toBe(1)
    expect(output()).toContain('UNVERIFIED')
    expect(output()).not.toMatch(/^VERIFIED/m)
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it.each(['cancelled', 'max_tokens', 'refusal', 'max_turn_requests', 'unknown', undefined])(
    'rejects pong with non-success stop reason %s', async (stopReason) => {
      const { client, session } = adapter([text('pong'), { kind: 'done', data: { stopReason } }])
      await main(['codex'], client)
      expect(process.exitCode).toBe(1)
      expect(output()).toContain('UNVERIFIED')
      expect(session.dispose).toHaveBeenCalledOnce()
    },
  )

  it.each(['prompt', 'stream'] as const)('reports thrown %s failure and disposes', async (stage) => {
    const { client, session } = adapter([])
    if (stage === 'prompt') {
      session.prompt = vi.fn(() => { throw new Error('prompt failed') })
    } else {
      session.prompt = vi.fn(async function* () {
        yield text('pong')
        yield done
        throw new Error('stream failed')
      })
    }
    await main(['codex'], client)
    expect(process.exitCode).toBe(1)
    expect(output()).toContain('UNVERIFIED')
    expect(output()).toContain(stage + ' failed')
    expect(output()).not.toMatch(/^VERIFIED/m)
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it.each(['claude', 'codex'] as const)('accepts chunked pong with surrounding whitespace for %s', async (backend) => {
    const { client, session } = adapter([text(' \npo'), text('n'), text('g\t'), done])
    await main([backend], client)
    expect(process.exitCode).toBe(0)
    expect(output()).toMatch(/^VERIFIED/m)
    expect(output()).not.toContain('UNVERIFIED')
    expect(client.newSession).toHaveBeenCalledWith(backend)
    expect(session.prompt).toHaveBeenCalledWith({ text: 'Reply with exactly the word "pong" and nothing else.' })
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    { name: 'missing text', updates: [done] },
    { name: 'whitespace only', updates: [text(' \n\t'), done] },
    { name: 'wrong answer', updates: [text('ping'), done] },
    { name: 'extra prose', updates: [text('pong, all good'), done] },
    { name: 'internal whitespace', updates: [text('po ng'), done] },
    { name: 'missing terminal', updates: [text('pong')] },
    { name: 'error after pong and done', updates: [text('pong'), done, { kind: 'error', data: { message: '401' } }] },
  ] satisfies { name: string; updates: AcpUpdate[] }[])('rejects $name and disposes', async ({ updates }) => {
    const { client, session } = adapter(updates)
    await main(['codex'], client)
    expect(process.exitCode).toBe(1)
    expect(output()).toContain('UNVERIFIED')
    expect(output()).not.toMatch(/^VERIFIED/m)
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it('reports a session/spawn rejection without claiming verification', async () => {
    const client: AcpClient = { newSession: vi.fn(async () => { throw new Error('spawn failed') }) }
    await main(['codex'], client)
    expect(process.exitCode).toBe(1)
    expect(output()).toContain('UNVERIFIED')
    expect(output()).toContain('spawn failed')
    expect(output()).not.toMatch(/^VERIFIED/m)
  })

  it('tries both default backends and preserves an earlier failure', async () => {
    const failed = adapter([text('401'), done])
    const passed = adapter([text('pong'), done])
    const client: AcpClient = {
      newSession: vi.fn().mockResolvedValueOnce(failed.session).mockResolvedValueOnce(passed.session),
    }
    await main([], client)
    expect(vi.mocked(client.newSession).mock.calls).toEqual([['claude'], ['codex']])
    expect(process.exitCode).toBe(1)
    expect(failed.session.dispose).toHaveBeenCalledOnce()
    expect(passed.session.dispose).toHaveBeenCalledOnce()
  })
})
