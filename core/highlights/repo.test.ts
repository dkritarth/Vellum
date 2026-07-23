import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { upsertPaper } from '../library/repo.js'
import { openDb } from '../store/db.js'
import { createHighlight, deleteHighlight, listHighlights } from './repo.js'

describe('highlights repo', () => {
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

  it('returns an empty list when a paper has no highlights yet', () => {
    expect(listHighlights(db, 'attention-is-all-you-need')).toEqual([])
  })

  it('creates a highlight and reads it back', () => {
    const created = createHighlight(db, {
      id: 'h1',
      paperSlug: 'attention-is-all-you-need',
      page: 3,
      color: 'yellow',
      quote: 'scaled dot-product attention',
      anchor: '{"start":10,"end":40}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(created).toEqual({
      id: 'h1',
      paperSlug: 'attention-is-all-you-need',
      page: 3,
      color: 'yellow',
      quote: 'scaled dot-product attention',
      anchor: '{"start":10,"end":40}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const highlights = listHighlights(db, 'attention-is-all-you-need')
    expect(highlights).toEqual([created])
  })

  it('lists multiple highlights for a paper ordered by page then created_at ascending', () => {
    createHighlight(db, {
      id: 'h-page2-later',
      paperSlug: 'attention-is-all-you-need',
      page: 2,
      color: 'green',
      quote: 'second page, later',
      anchor: '{}',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    createHighlight(db, {
      id: 'h-page1',
      paperSlug: 'attention-is-all-you-need',
      page: 1,
      color: 'blue',
      quote: 'first page',
      anchor: '{}',
      createdAt: '2026-01-03T00:00:00.000Z',
    })
    createHighlight(db, {
      id: 'h-page2-earlier',
      paperSlug: 'attention-is-all-you-need',
      page: 2,
      color: 'pink',
      quote: 'second page, earlier',
      anchor: '{}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const highlights = listHighlights(db, 'attention-is-all-you-need')
    expect(highlights.map((h) => h.id)).toEqual(['h-page1', 'h-page2-earlier', 'h-page2-later'])
  })

  it('only returns highlights for the requested paper', () => {
    upsertPaper(db, {
      slug: 'other-paper',
      title: 'Other Paper',
      authors: [],
      addedAt: new Date().toISOString(),
    })
    createHighlight(db, {
      id: 'h-mine',
      paperSlug: 'attention-is-all-you-need',
      page: 1,
      color: 'yellow',
      quote: 'mine',
      anchor: '{}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    createHighlight(db, {
      id: 'h-other',
      paperSlug: 'other-paper',
      page: 1,
      color: 'yellow',
      quote: 'other',
      anchor: '{}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const highlights = listHighlights(db, 'attention-is-all-you-need')
    expect(highlights.map((h) => h.id)).toEqual(['h-mine'])
  })

  it('deletes a highlight', () => {
    createHighlight(db, {
      id: 'h1',
      paperSlug: 'attention-is-all-you-need',
      page: 1,
      color: 'yellow',
      quote: 'to be deleted',
      anchor: '{}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    deleteHighlight(db, 'h1')
    expect(listHighlights(db, 'attention-is-all-you-need')).toEqual([])
  })

  it('deleting a highlight that does not exist is a no-op', () => {
    expect(() => deleteHighlight(db, 'no-such-id')).not.toThrow()
  })

  it('deleting the paper cascades and removes its highlights', () => {
    createHighlight(db, {
      id: 'h1',
      paperSlug: 'attention-is-all-you-need',
      page: 1,
      color: 'yellow',
      quote: 'cascade me',
      anchor: '{}',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    db.prepare('DELETE FROM papers WHERE slug = ?').run('attention-is-all-you-need')

    const row = db.prepare('SELECT * FROM highlights WHERE id = ?').get('h1')
    expect(row).toBeUndefined()
  })
})
