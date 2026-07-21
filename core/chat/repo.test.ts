import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openDb } from '../store/db.js'
import { upsertPaper } from '../library/repo.js'
import { addChatMessage, createChatSession, getChatMessages, getLatestChatSession } from './repo.js'

describe('chat repo', () => {
  let db: Database

  beforeEach(() => {
    db = openDb({ path: ':memory:' })
    upsertPaper(db, {
      slug: 'attention-is-all-you-need',
      title: 'Attention Is All You Need',
      authors: ['A. Vaswani'],
      addedAt: new Date().toISOString(),
    })
  })

  afterEach(() => {
    db.close()
  })

  it('creates a chat session scoped to a paper', () => {
    const session = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    expect(session.id).toBeGreaterThan(0)
    expect(session.paperSlug).toBe('attention-is-all-you-need')
    expect(session.backend).toBe('claude')
  })

  it('returns undefined when a paper has no chat session yet', () => {
    expect(getLatestChatSession(db, 'no-such-paper')).toBeUndefined()
  })

  it('returns the most recently created session for a paper', () => {
    createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    const second = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })

    const latest = getLatestChatSession(db, 'attention-is-all-you-need')
    expect(latest?.id).toBe(second.id)
  })

  it('appends and reloads messages for a session in order', () => {
    const session = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    addChatMessage(db, { sessionId: session.id, role: 'user', content: 'What is the core contribution?' })
    addChatMessage(db, { sessionId: session.id, role: 'assistant', content: 'The Transformer architecture.' })

    const messages = getChatMessages(db, session.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'What is the core contribution?' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'The Transformer architecture.' })
  })

  it('keeps messages scoped to their own session', () => {
    const a = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    const b = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    addChatMessage(db, { sessionId: a.id, role: 'user', content: 'in session a' })
    addChatMessage(db, { sessionId: b.id, role: 'user', content: 'in session b' })

    expect(getChatMessages(db, a.id)).toHaveLength(1)
    expect(getChatMessages(db, b.id)).toHaveLength(1)
  })
})
