import type { Database } from 'better-sqlite3'
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

  describe('listPapers search + sort [P1-08]', () => {
    function seed(db: Database): void {
      upsertPaper(
        db,
        makeRecord({
          slug: 'attention',
          title: 'Attention Is All You Need',
          year: 2017,
          addedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      upsertPaper(
        db,
        makeRecord({
          slug: 'bert',
          title: 'BERT: Pre-training of Deep Bidirectional Transformers',
          year: 2019,
          addedAt: '2026-03-01T00:00:00.000Z',
        }),
      )
      upsertPaper(
        db,
        makeRecord({
          slug: 'gpt3',
          title: 'Language Models are Few-Shot Learners',
          year: 2020,
          addedAt: '2026-02-01T00:00:00.000Z',
        }),
      )
    }

    it.each([
      { desc: 'no options: added_at desc (default)', options: undefined, expected: ['bert', 'gpt3', 'attention'] },
      {
        desc: 'sort=title asc',
        options: { sort: 'title' as const, order: 'asc' as const },
        expected: ['attention', 'bert', 'gpt3'],
      },
      {
        desc: 'sort=year asc',
        options: { sort: 'year' as const, order: 'asc' as const },
        expected: ['attention', 'bert', 'gpt3'],
      },
      {
        desc: 'sort=year desc',
        options: { sort: 'year' as const, order: 'desc' as const },
        expected: ['gpt3', 'bert', 'attention'],
      },
      { desc: 'search "bert" matches title case-insensitively', options: { search: 'BERT' }, expected: ['bert'] },
      { desc: 'search "transformers" (substring, mid-title)', options: { search: 'transformers' }, expected: ['bert'] },
      { desc: 'search with no match returns empty', options: { search: 'quantum computing' }, expected: [] },
      {
        desc: 'search + sort combine',
        options: { search: 'a', sort: 'title' as const, order: 'asc' as const },
        expected: ['attention', 'bert', 'gpt3'],
      },
    ])('$desc', ({ options, expected }) => {
      const db = openDb({ path: ':memory:' })
      try {
        seed(db)
        const rows = listPapers(db, options)
        expect(rows.map((r) => r.slug)).toEqual(expected)
      } finally {
        db.close()
      }
    })

    it('treats LIKE metacharacters (% and _) in search as literal text, not wildcards', () => {
      const db = openDb({ path: ':memory:' })
      try {
        upsertPaper(db, makeRecord({ slug: 'literal', title: '100% Foo_Bar Study', addedAt: '2026-01-01T00:00:00.000Z' }))
        upsertPaper(db, makeRecord({ slug: 'other', title: 'Unrelated Paper', addedAt: '2026-01-02T00:00:00.000Z' }))

        // '%' unescaped would match everything; it must only match the literal '100% Foo_Bar' title.
        expect(listPapers(db, { search: '100% Foo' }).map((r) => r.slug)).toEqual(['literal'])
        // '_' unescaped matches any single char; it must not match "FooXBar".
        upsertPaper(db, makeRecord({ slug: 'decoy', title: 'FooXBar Study', addedAt: '2026-01-03T00:00:00.000Z' }))
        expect(listPapers(db, { search: 'Foo_Bar' }).map((r) => r.slug)).toEqual(['literal'])
      } finally {
        db.close()
      }
    })

    it('an unrecognized sort column falls back to the added_at default rather than being interpolated', () => {
      const db = openDb({ path: ':memory:' })
      try {
        seed(db)
        // Simulate an untrusted/mistyped value slipping past compile-time types (e.g. from IPC).
        const rows = listPapers(db, { sort: 'slug; DROP TABLE papers; --' as unknown as 'title' })
        expect(rows.map((r) => r.slug)).toEqual(['bert', 'gpt3', 'attention'])
        // Table must still exist and be queryable.
        expect(listPapers(db)).toHaveLength(3)
      } finally {
        db.close()
      }
    })
  })
})
