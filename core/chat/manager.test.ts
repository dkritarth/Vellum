// ChatManager tests. The ACP agent call is always mocked via a fake
// AcpClient/AcpSession — no real adapter spawned (see AGENTS.md). Uses an
// in-memory SQLite DB per test (core/store/db.ts's openDb({ path: ':memory:' })).

import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AcpClient, AcpPromptRequest, AcpSession, AcpUpdate } from '../acp/client.js'
import { upsertPaper } from '../library/repo.js'
import { openDb } from '../store/db.js'
import { ChatManager } from './manager.js'
import { getChatMessages } from './repo.js'

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

class FakeClient implements AcpClient {
  sessions: FakeSession[] = []
  newSessionCalls = 0

  constructor(
    private readonly updates: AcpUpdate[] = [],
    private readonly newSessionImpl?: () => Promise<AcpSession>,
  ) {}

  async newSession(): Promise<AcpSession> {
    this.newSessionCalls += 1
    if (this.newSessionImpl) return this.newSessionImpl()
    const session = new FakeSession(this.updates)
    this.sessions.push(session)
    return session
  }
}

function textUpdate(text: string): AcpUpdate {
  return { kind: 'text', data: { type: 'text', text } }
}

const doneUpdate: AcpUpdate = { kind: 'done', data: { stopReason: 'end_turn' } }

describe('ChatManager', () => {
  let db: Database
  const slug = 'attention-is-all-you-need'
  const mdPath = 'data/papers/attention-is-all-you-need/paper.md'

  beforeEach(() => {
    db = openDb({ path: ':memory:' })
    upsertPaper(db, { slug, title: 'Attention Is All You Need', authors: [], addedAt: new Date().toISOString() })
  })

  afterEach(() => {
    db.close()
  })

  it('streams text chunks then persists the user + assistant messages', async () => {
    const client = new FakeClient([textUpdate('The core '), textUpdate('contribution is the Transformer.'), doneUpdate])
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })

    const events: string[] = []
    await manager.runTurn(
      { db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'What is the core contribution?' },
      (event) => events.push(event.kind),
    )

    expect(events).toEqual(['text', 'text', 'done'])

    const messages = getChatMessages(db, session.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'What is the core contribution?' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'The core contribution is the Transformer.' })
  })

  it('passes the paper markdown path as a context file (grounding)', async () => {
    const client = new FakeClient([doneUpdate])
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })

    await manager.runTurn({ db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'hi' }, () => {})

    expect(client.sessions[0]?.requests[0]?.contextFiles).toEqual([mdPath])
  })

  it('the prompt text instructs the agent to ground its reply in the paper (cite sections/quotes)', async () => {
    const client = new FakeClient([doneUpdate])
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })

    await manager.runTurn(
      { db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'What is the core contribution?' },
      () => {},
    )

    const promptText = client.sessions[0]?.requests[0]?.text ?? ''
    expect(promptText).toContain(mdPath)
    expect(promptText.toLowerCase()).toContain('cite')
    expect(promptText).toContain('What is the core contribution?')
  })

  it('recaps prior history into a freshly (re)spawned ACP session so a resumed chat has context', async () => {
    // First turn establishes history, then the session cache is dropped
    // (simulating an app restart) without touching the DB.
    const client = new FakeClient([textUpdate('answer'), doneUpdate])
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })
    await manager.runTurn({ db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'q1' }, () => {})

    // Simulate a fresh process: a brand-new ChatManager, same DB, same slug.
    const freshManager = new ChatManager(client)
    const reopened = freshManager.openChat({ db, paperSlug: slug })
    await freshManager.runTurn({ db, chatSessionId: reopened.session.id, paperSlug: slug, mdPath, text: 'q2' }, () => {})

    const secondTurnPrompt = client.sessions[1]?.requests[0]?.text ?? ''
    expect(secondTurnPrompt).toContain('q1')
    expect(secondTurnPrompt).toContain('answer')
    expect(secondTurnPrompt).toContain('q2')
  })

  it('does not re-recap on a second turn against an already-live ACP session', async () => {
    const client = new FakeClient([textUpdate('a1'), doneUpdate])
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })
    await manager.runTurn({ db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'q1' }, () => {})
    await manager.runTurn({ db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'q2' }, () => {})

    expect(client.sessions).toHaveLength(1)
    const secondRequest = client.sessions[0]?.requests[1]?.text ?? ''
    expect(secondRequest).not.toContain('q1')
    expect(secondRequest).toContain('q2')
  })

  it('reloads prior history on openChat without starting a new ACP session', async () => {
    const client = new FakeClient([textUpdate('answer'), doneUpdate])
    const manager = new ChatManager(client)
    const first = manager.openChat({ db, paperSlug: slug })
    await manager.runTurn({ db, chatSessionId: first.session.id, paperSlug: slug, mdPath, text: 'q1' }, () => {})

    const reopened = manager.openChat({ db, paperSlug: slug })
    expect(reopened.session.id).toBe(first.session.id)
    expect(reopened.messages.map((m) => m.content)).toEqual(['q1', 'answer'])
    // The turn above already spawned one ACP session; re-opening the tab
    // (openChat) must not spawn a second one.
    expect(client.newSessionCalls).toBe(1)
  })

  it('newChat starts a fresh session row and disposes the cached ACP session', async () => {
    const client = new FakeClient([textUpdate('answer'), doneUpdate])
    const manager = new ChatManager(client)
    const first = manager.openChat({ db, paperSlug: slug })
    await manager.runTurn({ db, chatSessionId: first.session.id, paperSlug: slug, mdPath, text: 'q1' }, () => {})
    const cachedSession = client.sessions[0]

    const fresh = await manager.newChat({ db, paperSlug: slug })

    expect(fresh.id).not.toBe(first.session.id)
    expect(cachedSession?.disposed).toBe(true)
    expect(getChatMessages(db, fresh.id)).toHaveLength(0)

    // Next turn spawns a genuinely new ACP session rather than reusing the disposed one.
    await manager.runTurn({ db, chatSessionId: fresh.id, paperSlug: slug, mdPath, text: 'q2' }, () => {})
    expect(client.newSessionCalls).toBe(2)
  })

  it('surfaces an adapter spawn failure as an error event without crashing', async () => {
    const client = new FakeClient([], async () => {
      throw new Error('failed to spawn ACP adapter')
    })
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })

    const events: Array<{ kind: string; message?: string }> = []
    await manager.runTurn({ db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'hi' }, (event) =>
      events.push(event.kind === 'error' ? { kind: event.kind, message: event.message } : { kind: event.kind }),
    )

    expect(events).toEqual([{ kind: 'error', message: 'failed to spawn ACP adapter' }])
    // The user's turn is still persisted even though the reply failed.
    expect(getChatMessages(db, session.id)).toHaveLength(1)
  })

  it('surfaces a mid-stream error update without persisting a partial assistant message', async () => {
    const client = new FakeClient([textUpdate('partial '), { kind: 'error', data: { message: 'turn timed out' } }])
    const manager = new ChatManager(client)
    const { session } = manager.openChat({ db, paperSlug: slug })

    const events: Array<{ kind: string }> = []
    await manager.runTurn({ db, chatSessionId: session.id, paperSlug: slug, mdPath, text: 'hi' }, (event) =>
      events.push({ kind: event.kind }),
    )

    expect(events.at(-1)).toEqual({ kind: 'error' })
    const messages = getChatMessages(db, session.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
  })
})
