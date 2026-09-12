import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../store/db.js'
import { upsertPaper } from '../library/repo.js'
import {
  clearSuggestedQuestions,
  derivePaperQuestions,
  getCachedQuestions,
  saveSuggestedQuestions,
} from './repo.js'

describe('suggested questions repo [L2-03]', () => {
  let db: Database
  const slug = 'attention-is-all-you-need'

  beforeEach(() => {
    db = openDb({ path: ':memory:' })
    upsertPaper(db, {
      slug,
      title: 'Attention Is All You Need',
      authors: ['A. Vaswani'],
      addedAt: new Date().toISOString(),
    })
  })

  afterEach(() => {
    db.close()
  })

  it('saves and retrieves cached suggested questions for a paper and backend', () => {
    const questions = [
      { question: 'How does multi-head attention work?', category: 'methodology' as const },
      { question: 'What BLEU score was achieved on WMT 2014?', category: 'results' as const },
      { question: 'What are the memory complexity bottlenecks?', category: 'limitations' as const },
    ]

    const saved = saveSuggestedQuestions(db, slug, 'claude', questions)
    expect(saved).toHaveLength(3)
    expect(saved[0].question).toBe('How does multi-head attention work?')
    expect(saved[0].category).toBe('methodology')
    expect(saved[0].backend).toBe('claude')

    const cached = getCachedQuestions(db, slug, 'claude')
    expect(cached).toHaveLength(3)
    expect(cached[1].question).toBe('What BLEU score was achieved on WMT 2014?')
    expect(cached[1].category).toBe('results')
  })

  it('keeps backend caches isolated', () => {
    saveSuggestedQuestions(db, slug, 'claude', [
      { question: 'Claude question 1', category: 'methodology' },
    ])
    saveSuggestedQuestions(db, slug, 'codex', [
      { question: 'Codex question 1', category: 'results' },
      { question: 'Codex question 2', category: 'limitations' },
    ])

    const claude = getCachedQuestions(db, slug, 'claude')
    expect(claude).toHaveLength(1)
    expect(claude[0].question).toBe('Claude question 1')

    const codex = getCachedQuestions(db, slug, 'codex')
    expect(codex).toHaveLength(2)
    expect(codex[0].question).toBe('Codex question 1')
  })

  it('replaces existing cache when saving new questions for same backend', () => {
    saveSuggestedQuestions(db, slug, 'claude', [
      { question: 'Old question', category: 'methodology' },
    ])
    saveSuggestedQuestions(db, slug, 'claude', [
      { question: 'New regenerated question', category: 'methodology' },
    ])

    const cached = getCachedQuestions(db, slug, 'claude')
    expect(cached).toHaveLength(1)
    expect(cached[0].question).toBe('New regenerated question')
  })

  it('clears cached questions explicitly', () => {
    saveSuggestedQuestions(db, slug, 'claude', [{ question: 'Q1' }])
    saveSuggestedQuestions(db, slug, 'codex', [{ question: 'Q2' }])

    clearSuggestedQuestions(db, slug, 'claude')
    expect(getCachedQuestions(db, slug, 'claude')).toHaveLength(0)
    expect(getCachedQuestions(db, slug, 'codex')).toHaveLength(1)

    clearSuggestedQuestions(db, slug)
    expect(getCachedQuestions(db, slug, 'codex')).toHaveLength(0)
  })

  it('derives paper-specific questions reflecting title, sections, and limitations', () => {
    const questions = derivePaperQuestions({
      title: 'Attention Is All You Need',
      sections: [
        { title: '1. Introduction' },
        { title: '2. Model Architecture and Multi-Head Attention' },
        { title: '3. Empirical Results and Machine Translation' },
        { title: '4. Discussion and Limitations' },
      ],
    })

    expect(questions.length).toBeGreaterThanOrEqual(3)
    expect(questions.length).toBeLessThanOrEqual(5)

    const methodQ = questions.find((q) => q.category === 'methodology')
    expect(methodQ?.question).toContain('Model Architecture and Multi-Head Attention')

    const resultsQ = questions.find((q) => q.category === 'results')
    expect(resultsQ?.question).toContain('Empirical Results and Machine Translation')

    const limitQ = questions.find((q) => q.category === 'limitations')
    expect(limitQ?.question).toContain('Discussion and Limitations')
  })

  it('cascades deletion when paper is deleted from papers table', () => {
    saveSuggestedQuestions(db, slug, 'claude', [{ question: 'Q1' }])
    expect(getCachedQuestions(db, slug, 'claude')).toHaveLength(1)

    db.prepare('DELETE FROM papers WHERE slug = ?').run(slug)
    expect(getCachedQuestions(db, slug, 'claude')).toHaveLength(0)
  })
})
