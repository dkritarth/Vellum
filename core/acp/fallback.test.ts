import { describe, expect, it } from 'vitest'

import type { AcpBackend, AcpClient, AcpSession } from './client'
import { backendOrder, newSessionWithFallback, runWithFallback } from './fallback'

function clientWith(working: AcpBackend[]): AcpClient & { tried: AcpBackend[] } {
  const tried: AcpBackend[] = []
  return {
    tried,
    async newSession(backend: AcpBackend): Promise<AcpSession> {
      tried.push(backend)
      if (!working.includes(backend)) throw new Error(`failed to spawn ACP adapter for ${backend}`)
      return { id: backend, prompt: async function* () {}, dispose: async () => {} } as unknown as AcpSession
    },
  } as AcpClient & { tried: AcpBackend[] }
}

describe('backendOrder', () => {
  it('defaults to Codex, then Claude, then Gemini', () => {
    expect(backendOrder()).toEqual(['codex', 'claude', 'antigravity'])
  })

  it('puts the preferred backend first without duplicates', () => {
    expect(backendOrder('claude')).toEqual(['claude', 'codex', 'antigravity'])
    expect(backendOrder(['antigravity', 'codex'])).toEqual(['antigravity', 'codex', 'claude'])
  })
})

describe('newSessionWithFallback', () => {
  it('uses the first backend whose session starts', async () => {
    const client = clientWith(['codex'])
    const result = await newSessionWithFallback(client, ['claude', 'codex', 'antigravity'])
    expect(result?.backend).toBe('codex')
    expect(client.tried).toEqual(['claude', 'codex'])
  })

  it('returns undefined when no backend starts', async () => {
    const client = clientWith([])
    expect(await newSessionWithFallback(client, backendOrder())).toBeUndefined()
    expect(client.tried).toEqual(['codex', 'claude', 'antigravity'])
  })
})

describe('runWithFallback', () => {
  it('retries on the next backend when a started session produces no usable result', async () => {
    const client = clientWith(['codex', 'claude', 'antigravity'])
    const seen: string[] = []
    const run = await runWithFallback(
      client,
      ['codex', 'claude', 'antigravity'],
      async (session) => { seen.push((session as unknown as { id: string }).id); return seen.length === 1 ? '' : 'metadata' },
      (result) => result.length > 0,
    )
    expect(run).toEqual({ result: 'metadata', backend: 'claude', accepted: true })
    expect(seen).toEqual(['codex', 'claude'])
  })

  it('stops after the turn limit and returns the last result', async () => {
    const client = clientWith(['codex', 'claude', 'antigravity'])
    const run = await runWithFallback(client, ['codex', 'claude', 'antigravity'], async () => '', (result) => result.length > 0, { maxTurns: 2 })
    expect(run).toEqual({ result: '', backend: 'claude', accepted: false })
    expect(client.tried).toEqual(['codex', 'claude'])
  })

  it('stops at the deadline and disposes a session that starts too late', async () => {
    let lateDisposed = false
    let resolveLate!: (session: AcpSession) => void
    const client: AcpClient = {
      newSession: () => new Promise<AcpSession>((resolve) => { resolveLate = resolve }),
    }
    const started = Date.now()
    const run = await runWithFallback(client, ['claude', 'codex'], async () => 'x', () => true, { deadlineMs: 50 })
    expect(run).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1000)
    resolveLate({ prompt: async function* () {}, dispose: async () => { lateDisposed = true } } as unknown as AcpSession)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(lateDisposed).toBe(true)
  })
})
