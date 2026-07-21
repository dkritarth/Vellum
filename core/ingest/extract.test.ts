// Tests for extractPaper(). The ACP agent call is always mocked here via a
// fake AcpClient/AcpSession — no real adapter is spawned in unit tests (see
// AGENTS.md: tests never require a live, signed-in adapter CLI). The one
// live-agent check is documented as a manual command in extract.ts's module
// comment, not exercised here.

import { describe, expect, it } from 'vitest'
import type { AcpClient, AcpPromptRequest, AcpSession, AcpUpdate } from '../acp/client.js'
import { extractPaper } from './extract.js'

/** Fake session that replays a canned update sequence, ignoring the prompt. */
class FakeSession implements AcpSession {
  disposed = false
  requests: AcpPromptRequest[] = []

  constructor(private readonly updates: AcpUpdate[]) {}

  async *prompt(req: AcpPromptRequest): AsyncIterable<AcpUpdate> {
    this.requests.push(req)
    for (const update of this.updates) yield update
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

/** Fake client. `newSessionImpl` lets a test override session creation
 * entirely (e.g. to simulate a spawn failure). */
class FakeClient implements AcpClient {
  session: FakeSession | undefined

  constructor(
    private readonly updates: AcpUpdate[] = [],
    private readonly newSessionImpl?: () => Promise<AcpSession>,
  ) {}

  async newSession(): Promise<AcpSession> {
    if (this.newSessionImpl) return this.newSessionImpl()
    this.session = new FakeSession(this.updates)
    return this.session
  }
}

function textUpdate(text: string): AcpUpdate {
  return { kind: 'text', data: { type: 'text', text } }
}

const doneUpdate: AcpUpdate = { kind: 'done', data: { stopReason: 'end_turn' } }

const HAPPY_JSON = JSON.stringify({
  sections: [
    { title: 'Abstract', startOffset: 0, endOffset: 120 },
    { title: 'Introduction', startOffset: 121, endOffset: 900 },
  ],
  metadata: {
    title: 'Attention Is All You Need, Again',
    authors: ['Jane Doe', 'John Smith'],
    year: 2024,
    venue: 'NeurIPS 2024',
    abstract: 'This paper revisits attention mechanisms.',
  },
})

describe('extractPaper', () => {
  it('parses sections + metadata from a single well-formed JSON text update', async () => {
    const client = new FakeClient([textUpdate(HAPPY_JSON), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(false)
    expect(result.sections).toEqual([
      { title: 'Abstract', startOffset: 0, endOffset: 120 },
      { title: 'Introduction', startOffset: 121, endOffset: 900 },
    ])
    expect(result.metadata).toEqual({
      title: 'Attention Is All You Need, Again',
      authors: ['Jane Doe', 'John Smith'],
      year: 2024,
      venue: 'NeurIPS 2024',
      abstract: 'This paper revisits attention mechanisms.',
    })
    expect(client.session?.disposed).toBe(true)
  })

  it('passes paper.md as a contextFile and never inlines file content in the prompt text', async () => {
    const client = new FakeClient([textUpdate(HAPPY_JSON), doneUpdate])

    await extractPaper('/data/papers/x/paper.md', { client })

    const req = client.session?.requests[0]
    expect(req?.contextFiles).toEqual(['/data/papers/x/paper.md'])
    expect(req?.text).toContain('JSON')
  })

  it('reassembles JSON streamed across multiple text chunks', async () => {
    const half = Math.floor(HAPPY_JSON.length / 2)
    const client = new FakeClient([
      textUpdate(HAPPY_JSON.slice(0, half)),
      textUpdate(HAPPY_JSON.slice(half)),
      doneUpdate,
    ])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(false)
    expect(result.sections).toHaveLength(2)
    expect(result.metadata.title).toBe('Attention Is All You Need, Again')
  })

  it('strips a markdown ```json fence around the JSON payload', async () => {
    const fenced = '```json\n' + HAPPY_JSON + '\n```'
    const client = new FakeClient([textUpdate(fenced), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(false)
    expect(result.sections).toHaveLength(2)
  })

  it('tolerates prose surrounding the JSON object', async () => {
    const withProse = `Sure, here is the extraction:\n${HAPPY_JSON}\nHope that helps!`
    const client = new FakeClient([textUpdate(withProse), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(false)
    expect(result.metadata.year).toBe(2024)
  })

  it('degrades to an empty-sections result on a paper with no sections field, without throwing', async () => {
    const noSections = JSON.stringify({
      metadata: { title: 'Odd Paper' },
    })
    const client = new FakeClient([textUpdate(noSections), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(result.sections).toEqual([])
    expect(result.metadata).toEqual({ title: 'Odd Paper' })
  })

  it('drops malformed individual section entries but keeps the well-formed ones', async () => {
    const mixed = JSON.stringify({
      sections: [
        { title: 'Abstract', startOffset: 0, endOffset: 10 },
        { title: 42 }, // invalid: title must be string
        { startOffset: 5 }, // invalid: missing title
        'not an object',
      ],
      metadata: {},
    })
    const client = new FakeClient([textUpdate(mixed), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(result.sections).toEqual([{ title: 'Abstract', startOffset: 0, endOffset: 10 }])
  })

  it('drops metadata fields with the wrong type instead of throwing', async () => {
    const badMeta = JSON.stringify({
      sections: [],
      metadata: { title: 'Ok Title', year: 'not-a-number', authors: 'not-an-array' },
    })
    const client = new FakeClient([textUpdate(badMeta), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.metadata).toEqual({ title: 'Ok Title' })
  })

  it('never throws and returns a degraded empty result on totally unparseable output', async () => {
    const client = new FakeClient([textUpdate('the agent rambled and produced no JSON at all'), doneUpdate])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(result.sections).toEqual([])
    expect(result.metadata).toEqual({})
  })

  it('never throws and degrades on an empty update stream', async () => {
    const client = new FakeClient([])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(result.sections).toEqual([])
  })

  it('never throws when the agent stream yields an error update', async () => {
    const client = new FakeClient([
      textUpdate('{ "sections": ['), // truncated
      { kind: 'error', data: { message: 'adapter died mid-turn' } },
    ])

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(result.sections).toEqual([])
    expect(client.session?.disposed).toBe(true)
  })

  it('never throws when newSession() itself rejects (adapter fails to spawn)', async () => {
    const client = new FakeClient([], () => Promise.reject(new Error('failed to spawn ACP adapter')))

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(result.sections).toEqual([])
    expect(result.metadata).toEqual({})
  })

  it('disposes the session even when prompt() throws mid-stream', async () => {
    class ThrowingSession implements AcpSession {
      disposed = false
      async *prompt(): AsyncIterable<AcpUpdate> {
        yield textUpdate('{"sections":[]')
        throw new Error('stream broke')
      }
      async dispose(): Promise<void> {
        this.disposed = true
      }
    }
    const session = new ThrowingSession()
    const client: AcpClient = { newSession: () => Promise.resolve(session) }

    const result = await extractPaper('/data/papers/x/paper.md', { client })

    expect(result.degraded).toBe(true)
    expect(session.disposed).toBe(true)
  })
})
