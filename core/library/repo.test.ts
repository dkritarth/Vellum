import { describe, expect, it } from 'vitest'
import { openDb } from '../store/db.js'
import { getPaper, listPapers, upsertPaper } from './repo.js'
import type { PaperRecord } from './repo.js'

function makeRecord(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    slug: 'arxiv-2401.12345',
    title: 'Attention Is All You Need, Again',
    authors: ['Jane Doe', 'John Smith'],
    year: 2024,
    venue: 'NeurIPS 2024',
    doi: undefined,
    arxivId: '2401.12345',
    abstract: 'This paper revisits attention mechanisms.',
    mdPath: 'data/papers/arxiv-2401.12345/paper.md',
    pdfPath: 'data/papers/arxiv-2401.12345/paper.pdf',
    sections: [{ title: 'Abstract' }, { title: 'Introduction' }],
    addedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('repo', () => {
  it('inserts a paper and reads it back with JSON fields round-tripped', () => {
    const db = openDb({ path: ':memory:' })
    try {
      upsertPaper(db, makeRecord())

      const row = getPaper(db, 'arxiv-2401.12345')
      expect(row).toEqual(makeRecord())
    } finally {
      db.close()
    }
  })

  it('returns undefined for a slug that does not exist', () => {
    const db = openDb({ path: ':memory:' })
    try {
      expect(getPaper(db, 'nope')).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('upserting the same slug twice overwrites in place, no duplicate row', () => {
    const db = openDb({ path: ':memory:' })
    try {
      upsertPaper(db, makeRecord({ title: 'Original Title' }))
      upsertPaper(db, makeRecord({ title: 'Updated Title', year: 2025 }))

      const rows = listPapers(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.title).toBe('Updated Title')
      expect(rows[0]?.year).toBe(2025)
    } finally {
      db.close()
    }
  })

  it('handles missing optional fields as undefined / empty arrays, not null leaking through', () => {
    const db = openDb({ path: ':memory:' })
    try {
      upsertPaper(db, {
        slug: 'pdf-bare',
        title: 'Bare Paper',
        authors: [],
        addedAt: '2026-07-21T00:00:00.000Z',
      })

      const row = getPaper(db, 'pdf-bare')
      expect(row).toEqual({
        slug: 'pdf-bare',
        title: 'Bare Paper',
        authors: [],
        year: undefined,
        venue: undefined,
        doi: undefined,
        arxivId: undefined,
        abstract: undefined,
        mdPath: undefined,
        pdfPath: undefined,
        sections: [],
        addedAt: '2026-07-21T00:00:00.000Z',
      })
    } finally {
      db.close()
    }
  })

  it('listPapers orders most-recently-added first', () => {
    const db = openDb({ path: ':memory:' })
    try {
      upsertPaper(db, makeRecord({ slug: 'p1', addedAt: '2026-01-01T00:00:00.000Z' }))
      upsertPaper(db, makeRecord({ slug: 'p2', addedAt: '2026-06-01T00:00:00.000Z' }))

      const rows = listPapers(db)
      expect(rows.map((r) => r.slug)).toEqual(['p2', 'p1'])
    } finally {
      db.close()
    }
  })
})
