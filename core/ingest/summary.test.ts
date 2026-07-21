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
