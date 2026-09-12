import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openDb } from '../store/db.js'
import { upsertPaper } from '../library/repo.js'
import { addChatMessage, createChatSession, deleteChatSession, getChatMessages, getLatestChatSession, listChatSessions, updateChatSessionTitle } from './repo.js'

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

  it('lists chat sessions across papers with paper title and stable fallback title [L2-02]', () => {
    upsertPaper(db, {
      slug: 'bert-paper',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers',
      authors: ['Jacob Devlin'],
      addedAt: new Date().toISOString(),
    })

    const s1 = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    addChatMessage(db, { sessionId: s1.id, role: 'user', content: 'Explain multi-head attention mechanism in simple terms' })
    addChatMessage(db, { sessionId: s1.id, role: 'assistant', content: 'Multi-head attention allows the model to jointly attend to information...' })

    const s2 = createChatSession(db, { paperSlug: 'bert-paper', backend: 'codex', title: 'BERT fine-tuning discussion' })
    addChatMessage(db, { sessionId: s2.id, role: 'user', content: 'How does masked LM work?' })

    const sessions = listChatSessions(db)
    expect(sessions).toHaveLength(2)

    // s2 was created after s1 and has recent message
    const bertSession = sessions.find((s) => s.id === s2.id)!
    expect(bertSession.paperTitle).toBe('BERT: Pre-training of Deep Bidirectional Transformers')
    expect(bertSession.title).toBe('BERT fine-tuning discussion')
    expect(bertSession.backend).toBe('codex')
    expect(bertSession.messageCount).toBe(1)
    expect(bertSession.preview).toBe('How does masked LM work?')

    const transformerSession = sessions.find((s) => s.id === s1.id)!
    expect(transformerSession.paperTitle).toBe('Attention Is All You Need')
    expect(transformerSession.title).toBe('Explain multi-head attention mechanism in simple terms')
    expect(transformerSession.backend).toBe('claude')
    expect(transformerSession.messageCount).toBe(2)
  })

  it('filters sessions by search term across title, paper, and message content [L2-02]', () => {
    const s1 = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude', title: 'Attention Deep Dive' })
    addChatMessage(db, { sessionId: s1.id, role: 'user', content: 'What about positional encodings?' })

    const s2 = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'codex' })
    addChatMessage(db, { sessionId: s2.id, role: 'user', content: 'Optimizer hyperparameters' })

    const matchedByMessage = listChatSessions(db, { search: 'positional' })
    expect(matchedByMessage).toHaveLength(1)
    expect(matchedByMessage[0].id).toBe(s1.id)

    const matchedByTitle = listChatSessions(db, { search: 'Deep Dive' })
    expect(matchedByTitle).toHaveLength(1)
    expect(matchedByTitle[0].id).toBe(s1.id)

    const noMatches = listChatSessions(db, { search: 'quantum' })
    expect(noMatches).toHaveLength(0)
  })

  it('gracefully handles orphaned sessions when paper record is missing [L2-02]', () => {
    // Disable FK temporarily to simulate missing paper
    db.pragma('foreign_keys = OFF')
    const orphaned = createChatSession(db, { paperSlug: 'deleted-paper', backend: 'claude' })
    addChatMessage(db, { sessionId: orphaned.id, role: 'user', content: 'Hello' })
    db.pragma('foreign_keys = ON')

    const sessions = listChatSessions(db)
    const target = sessions.find((s) => s.id === orphaned.id)
    expect(target).toBeDefined()
    expect(target?.paperSlug).toBe('deleted-paper')
    expect(target?.paperTitle).toBeNull()
  })

  it('updates title and deletes chat session with cascade [L2-02]', () => {
    const s = createChatSession(db, { paperSlug: 'attention-is-all-you-need', backend: 'claude' })
    addChatMessage(db, { sessionId: s.id, role: 'user', content: 'First message' })

    updateChatSessionTitle(db, s.id, 'Custom Renamed Title')
    let found = listChatSessions(db).find((item) => item.id === s.id)
    expect(found?.title).toBe('Custom Renamed Title')

    deleteChatSession(db, s.id)
    found = listChatSessions(db).find((item) => item.id === s.id)
    expect(found).toBeUndefined()
    expect(getChatMessages(db, s.id)).toHaveLength(0)
  })
})
