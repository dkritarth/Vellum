import { describe, expect, it } from 'vitest'

import type { AcpBackend, AcpClient, AcpSession } from './client'
import { backendOrder, newSessionWithFallback } from './fallback'

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
