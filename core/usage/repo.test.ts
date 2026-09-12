import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../store/migrate.js'
import { createChatSession } from '../chat/repo.js'
import { upsertPaper } from '../library/repo.js'
import {
  getUsageSummary,
  listUsageRecords,
  recordTurnUsage,
  
} from './repo.js'

describe('core/usage/repo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    upsertPaper(db, { slug: 'test-paper', title: 'Test Paper', authors: [], addedAt: '2026-01-01T00:00:00.000Z' })
    upsertPaper(db, { slug: 'paper-a', title: 'Paper A', authors: [], addedAt: '2026-01-01T00:00:00.000Z' })
    upsertPaper(db, { slug: 'paper-b', title: 'Paper B', authors: [], addedAt: '2026-01-01T00:00:00.000Z' })
    upsertPaper(db, { slug: 'p1', title: 'P1', authors: [], addedAt: '2026-01-01T00:00:00.000Z' })
    upsertPaper(db, { slug: 'p2', title: 'P2', authors: [], addedAt: '2026-01-01T00:00:00.000Z' })
  })

  it('records turn telemetry with metrics present', () => {
    const session = createChatSession(db, { paperSlug: 'test-paper', backend: 'claude' })

    const rec = recordTurnUsage(db, {
      sessionId: session.id,
      backend: 'claude',
      model: 'claude-3-7-sonnet',
      turnIndex: 0,
      inputTokens: 1200,
      outputTokens: 450,
      thoughtTokens: 100,
      cachedReadTokens: 300,
      totalTokens: 1650,
      contextUsed: 8400,
      contextSize: 200000,
      costAmount: 0.015,
      costCurrency: 'USD',
      hasMetrics: true,
      recordedAt: '2026-09-12T16:00:00.000Z',
    })

    expect(rec.id).toBeDefined()
    expect(rec.sessionId).toBe(session.id)
    expect(rec.hasMetrics).toBe(true)
    expect(rec.inputTokens).toBe(1200)
    expect(rec.outputTokens).toBe(450)
    expect(rec.totalTokens).toBe(1650)
    expect(rec.contextUsed).toBe(8400)
  })

  it('records turn with unavailable metrics without inventing zero values', () => {
    const session = createChatSession(db, { paperSlug: 'test-paper', backend: 'codex' })

    const rec = recordTurnUsage(db, {
      sessionId: session.id,
      backend: 'codex',
      model: 'gpt-5.5',
      turnIndex: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      hasMetrics: false,
      recordedAt: '2026-09-12T16:05:00.000Z',
    })

    expect(rec.hasMetrics).toBe(false)
    expect(rec.inputTokens).toBeNull()
    expect(rec.outputTokens).toBeNull()
    expect(rec.totalTokens).toBeNull()
  })

  it('updates existing record on turn retry to prevent double-counting', () => {
    const session = createChatSession(db, { paperSlug: 'test-paper', backend: 'claude' })

    // Turn 0 initially recorded
    recordTurnUsage(db, {
      sessionId: session.id,
      backend: 'claude',
      turnIndex: 0,
      inputTokens: 500,
      outputTokens: 100,
      totalTokens: 600,
      hasMetrics: true,
      recordedAt: '2026-09-12T16:00:00.000Z',
    })

    // Retrying turn 0 (e.g. error recovery or retry) updates same turn
    recordTurnUsage(db, {
      sessionId: session.id,
      backend: 'claude',
      turnIndex: 0,
      inputTokens: 520,
      outputTokens: 110,
      totalTokens: 630,
      hasMetrics: true,
      recordedAt: '2026-09-12T16:01:00.000Z',
    })

    const list = listUsageRecords(db, { sessionId: session.id })
    expect(list).toHaveLength(1)
    expect(list[0].inputTokens).toBe(520)
    expect(list[0].totalTokens).toBe(630)

    const summary = getUsageSummary(db)
    expect(summary.totalTurns).toBe(1)
    expect(summary.totalTokens).toBe(630)
  })

  it('returns explicit null (unavailable) for totals when no metrics emitted', () => {
    const session = createChatSession(db, { paperSlug: 'test-paper', backend: 'codex' })

    // 2 turns without adapter metrics
    recordTurnUsage(db, {
      sessionId: session.id,
      backend: 'codex',
      turnIndex: 0,
      hasMetrics: false,
      recordedAt: '2026-09-12T16:10:00.000Z',
    })
    recordTurnUsage(db, {
      sessionId: session.id,
      backend: 'codex',
      turnIndex: 1,
      hasMetrics: false,
      recordedAt: '2026-09-12T16:12:00.000Z',
    })

    const summary = getUsageSummary(db)
    expect(summary.totalTurns).toBe(2)
    expect(summary.turnsWithMetrics).toBe(0)
    expect(summary.totalInputTokens).toBeNull() // Not 0!
    expect(summary.totalOutputTokens).toBeNull() // Not 0!
    expect(summary.totalTokens).toBeNull() // Not 0!
    expect(summary.backends.codex.turnsCount).toBe(2)
    expect(summary.backends.codex.turnsWithMetrics).toBe(0)
    expect(summary.backends.codex.totalTokens).toBeNull()
  })

  it('aggregates across multiple backends and turns correctly', () => {
    const s1 = createChatSession(db, { paperSlug: 'paper-a', backend: 'claude' })
    const s2 = createChatSession(db, { paperSlug: 'paper-b', backend: 'codex' })

    // Claude turn with metrics
    recordTurnUsage(db, {
      sessionId: s1.id,
      backend: 'claude',
      turnIndex: 0,
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      costAmount: 0.01,
      hasMetrics: true,
      recordedAt: '2026-09-12T16:20:00.000Z',
    })

    // Claude turn 2 with metrics
    recordTurnUsage(db, {
      sessionId: s1.id,
      backend: 'claude',
      turnIndex: 1,
      inputTokens: 1500,
      outputTokens: 300,
      totalTokens: 1800,
      costAmount: 0.02,
      hasMetrics: true,
      recordedAt: '2026-09-12T16:22:00.000Z',
    })

    // Codex turn without metrics
    recordTurnUsage(db, {
      sessionId: s2.id,
      backend: 'codex',
      turnIndex: 0,
      hasMetrics: false,
      recordedAt: '2026-09-12T16:25:00.000Z',
    })

    const summary = getUsageSummary(db)
    expect(summary.totalTurns).toBe(3)
    expect(summary.turnsWithMetrics).toBe(2)
    expect(summary.totalInputTokens).toBe(2500)
    expect(summary.totalOutputTokens).toBe(500)
    expect(summary.totalTokens).toBe(3000)
    expect(summary.totalCost).toBeCloseTo(0.03)

    expect(summary.backends.claude.turnsCount).toBe(2)
    expect(summary.backends.claude.turnsWithMetrics).toBe(2)
    expect(summary.backends.claude.totalTokens).toBe(3000)

    expect(summary.backends.codex.turnsCount).toBe(1)
    expect(summary.backends.codex.turnsWithMetrics).toBe(0)
    expect(summary.backends.codex.totalTokens).toBeNull() // Honest unavailable for codex
  })

  it('filters listUsageRecords by backend and session', () => {
    const s1 = createChatSession(db, { paperSlug: 'p1', backend: 'claude' })
    const s2 = createChatSession(db, { paperSlug: 'p2', backend: 'codex' })

    recordTurnUsage(db, {
      sessionId: s1.id,
      backend: 'claude',
      turnIndex: 0,
      hasMetrics: true,
      totalTokens: 100,
      recordedAt: '2026-09-12T16:00:00.000Z',
    })
    recordTurnUsage(db, {
      sessionId: s2.id,
      backend: 'codex',
      turnIndex: 0,
      hasMetrics: false,
      recordedAt: '2026-09-12T16:01:00.000Z',
    })

    const claudeList = listUsageRecords(db, { backend: 'claude' })
    expect(claudeList).toHaveLength(1)
    expect(claudeList[0].backend).toBe('claude')

    const s2List = listUsageRecords(db, { sessionId: s2.id })
    expect(s2List).toHaveLength(1)
    expect(s2List[0].backend).toBe('codex')
  })
})
