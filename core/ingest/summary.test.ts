import { expect, it } from 'vitest'
import type { AcpClient, AcpPromptRequest, AcpSession, AcpUpdate } from '../acp/client.js'
import { summarizePaper } from './summary.js'

class FakeSession implements AcpSession {
  request: AcpPromptRequest | undefined
  async *prompt(request: AcpPromptRequest): AsyncIterable<AcpUpdate> {
    this.request = request
    yield { kind: 'text', data: { type: 'text', text: 'Grounded paper summary.' } }
    yield { kind: 'done', data: {} }
  }
  async dispose(): Promise<void> {}
}

it('generates a grounded summary using the paper markdown context', async () => {
  const session = new FakeSession()
  const client: AcpClient = { newSession: async (backend) => { expect(backend).toBe('codex'); return session } }
  await expect(summarizePaper('/papers/p1/paper.md', { client, backend: 'codex' })).resolves.toBe('Grounded paper summary.')
  expect(session.request?.contextFiles).toEqual(['/papers/p1/paper.md'])
})

it.each(['error', 'throw', 'EOF'] as const)('discards nonempty summary after %s and attempts disposal', async (failure) => {
  let disposed = false
  const client: AcpClient = {
    async newSession() {
      return {
        async *prompt() {
          yield { kind: 'text', data: { type: 'text', text: 'An unfinished summary.' } }
          if (failure === 'throw') throw new Error('stream broke')
          if (failure === 'error') yield { kind: 'error', data: { message: 'adapter failed' } }
        },
        async dispose() { disposed = true; throw new Error('cleanup failed') },
      }
    },
  }

  await expect(summarizePaper('/papers/p1/paper.md', { client })).resolves.toBeUndefined()
  expect(disposed).toBe(true)
})

it.each(['max_tokens', 'max_turn_requests', 'refusal', 'cancelled', 'future_reason'])('discards summary on explicit %s stop reason', async (stopReason) => {
  let disposed = false
  const client: AcpClient = { async newSession() { return {
    async *prompt() {
      yield { kind: 'text', data: { type: 'text', text: 'Nonempty interrupted summary.' } }
      yield { kind: 'done', data: { stopReason } }
    },
    async dispose() { disposed = true },
  } } }
  await expect(summarizePaper('/papers/p1/paper.md', { client })).resolves.toBeUndefined()
  expect(disposed).toBe(true)
})

it.each([{}, { stopReason: 'end_turn' }, null, undefined])('keeps completed chunked summary with done data %j despite disposal rejection', async (data) => {
  const client: AcpClient = { async newSession() { return {
    async *prompt() {
      yield { kind: 'text', data: { type: 'text', text: '  Grounded ' } }
      yield { kind: 'tool_call', data: {} }
      yield { kind: 'text', data: { type: 'text', text: 'paper summary.  ' } }
      yield { kind: 'done', data }
    },
    async dispose() { throw new Error('cleanup failed') },
  } } }
  await expect(summarizePaper('/papers/p1/paper.md', { client })).resolves.toBe('Grounded paper summary.')
})

it('returns no summary if spawning the adapter fails', async () => {
  const client: AcpClient = { newSession: async () => { throw new Error('spawn failed') } }
  await expect(summarizePaper('/papers/p1/paper.md', { client })).resolves.toBeUndefined()
})

it('returns no summary for a completed empty turn', async () => {
  const client: AcpClient = { async newSession() { return {
    async *prompt() { yield { kind: 'done', data: {} } },
    async dispose() {},
  } } }
  await expect(summarizePaper('/papers/p1/paper.md', { client })).resolves.toBeUndefined()
})
