import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { getNote, upsertNote } from '../notes/repo.js'
import { createHighlight, listHighlights } from '../highlights/repo.js'
import { createChatSession, addChatMessage, getChatSession, getChatMessages } from '../chat/repo.js'
import { createCollection, assignPaperToCollection, listPaperCollections, listCollections } from '../collections/repo.js'
import { saveSuggestedQuestions, getCachedQuestions } from '../questions/repo.js'
import { getPaper, listPapers, upsertPaper, trashPaper, restorePaper, purgePaper, isValidSlug, assertValidSlug, SLUG_PATTERN } from './repo.js'
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

  describe('author_orcids [P2-04]', () => {
    it('round-trips authorOrcids, including null entries for unknown authors', () => {
      const db = openDb({ path: ':memory:' })
      try {
        upsertPaper(
          db,
          makeRecord({
            slug: 'orcid-paper',
            authors: ['Jane Doe', 'John Smith'],
            authorOrcids: ['0000-0002-1825-0097', null],
          }),
        )

        const row = getPaper(db, 'orcid-paper')
        expect(row?.authors).toEqual(['Jane Doe', 'John Smith'])
        expect(row?.authorOrcids).toEqual(['0000-0002-1825-0097', null])
      } finally {
        db.close()
      }
    })

    it('a paper upserted without authorOrcids reads back with authorOrcids undefined, authors intact', () => {
      const db = openDb({ path: ':memory:' })
      try {
        upsertPaper(db, makeRecord({ slug: 'no-orcids' }))

        const row = getPaper(db, 'no-orcids')
        expect(row?.authorOrcids).toBeUndefined()
        expect(row?.authors).toEqual(['Jane Doe', 'John Smith'])
      } finally {
        db.close()
      }
    })

    it('an old row (author_orcids column NULL) reads back with authorOrcids undefined', () => {
      const db = openDb({ path: ':memory:' })
      try {
        // Simulate a pre-[P2-04] row inserted without touching the new column at all.
        db.prepare(
          `INSERT INTO papers (slug, title, authors, added_at) VALUES (?, ?, ?, ?)`,
        ).run('legacy', 'Legacy Paper', JSON.stringify(['Old Author']), '2026-01-01T00:00:00.000Z')

        const row = getPaper(db, 'legacy')
        expect(row?.authorOrcids).toBeUndefined()
        expect(row?.authors).toEqual(['Old Author'])
      } finally {
        db.close()
      }
    })
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

    it('filters papers by collectionId [L2-01]', () => {
      const db = openDb({ path: ':memory:' })
      try {
        seed(db)
        db.prepare("INSERT INTO collections (id, name) VALUES (1, 'Transformers')").run()
        db.prepare("INSERT INTO paper_collections (paper_slug, collection_id) VALUES ('attention', 1), ('bert', 1)").run()

        const inColl = listPapers(db, { collectionId: 1 })
        expect(inColl.map((r) => r.slug).sort()).toEqual(['attention', 'bert'])

        const searchInColl = listPapers(db, { collectionId: 1, search: 'BERT' })
        expect(searchInColl.map((r) => r.slug)).toEqual(['bert'])
      } finally {
        db.close()
      }
    })
  })

  describe('Trash and Purge operations [L2-04]', () => {
function seedDb(db: Database): void {
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

    it('trashes a paper, hiding it from default library while retaining it in trashed view', () => {
      const db = openDb({ path: ':memory:' })
      try {
        seedDb(db)
        expect(listPapers(db)).toHaveLength(3)

        // Trash 'bert'
        const trashed = trashPaper(db, 'bert')
        expect(trashed).toBeDefined()
        expect(trashed?.slug).toBe('bert')
        expect(trashed?.trashedAt).toBeTruthy()

        // Default list excludes trashed
        const active = listPapers(db)
        expect(active.map((p) => p.slug)).toEqual(['gpt3', 'attention'])

        // Trashed list includes bert
        const trashList = listPapers(db, { trashed: true })
        expect(trashList.map((p) => p.slug)).toEqual(['bert'])
      } finally {
        db.close()
      }
    })

    it('restores a trashed paper back to active Library', () => {
      const db = openDb({ path: ':memory:' })
      try {
        seedDb(db)
        trashPaper(db, 'bert')
        expect(listPapers(db)).toHaveLength(2)

        const restored = restorePaper(db, 'bert')
        expect(restored?.slug).toBe('bert')
        expect(restored?.trashedAt).toBeUndefined()

        const active = listPapers(db)
        expect(active.map((p) => p.slug)).toContain('bert')
        expect(listPapers(db, { trashed: true })).toHaveLength(0)
      } finally {
        db.close()
      }
    })

    it('permanently purges a paper from DB and removes its directory on disk', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-test-'))
      try {
        const paperDir = path.join(tmpDir, 'papers', 'purge-me')
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'content.pdf'), 'fake pdf')

        upsertPaper(db, makeRecord({ slug: 'purge-me', title: 'Paper To Purge' }))
        expect(getPaper(db, 'purge-me')).toBeDefined()
        upsertNote(db, 'purge-me', 'Research notes')
        createHighlight(db, {
          id: 'purge-highlight', paperSlug: 'purge-me', page: 1, color: 'yellow',
          quote: 'Relevant text', anchor: '{}', createdAt: '2026-01-01T00:00:00.000Z',
        })
        const session = createChatSession(db, { paperSlug: 'purge-me', backend: 'codex' })
        addChatMessage(db, { sessionId: session.id, role: 'user', content: 'Explain this' })
        const collection = createCollection(db, { name: 'Keep this collection' })
        assignPaperToCollection(db, { paperSlug: 'purge-me', collectionId: collection.id })
        saveSuggestedQuestions(db, 'purge-me', 'codex', [{ question: 'What changed?' }])

        const purged = purgePaper(db, 'purge-me', tmpDir)
        expect(purged).toBe(true)
        expect(getPaper(db, 'purge-me')).toBeUndefined()
        expect(fs.existsSync(paperDir)).toBe(false)
        expect(fs.readdirSync(path.join(tmpDir, 'papers'))).toEqual([])
        expect(getNote(db, 'purge-me')).toBeUndefined()
        expect(listHighlights(db, 'purge-me')).toEqual([])
        expect(getChatSession(db, session.id)).toBeUndefined()
        expect(getChatMessages(db, session.id)).toEqual([])
        expect(listPaperCollections(db, 'purge-me')).toEqual([])
        expect(listCollections(db)).toEqual([collection])
        expect(getCachedQuestions(db, 'purge-me', 'codex')).toEqual([])
      } finally {
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('purgePaper safely handles missing on-disk files without throwing', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-missing-'))
      try {
        upsertPaper(db, makeRecord({ slug: 'non-existent-files', title: 'Ghost Paper' }))
        const purged = purgePaper(db, 'non-existent-files', tmpDir)
        expect(purged).toBe(true)
        expect(getPaper(db, 'non-existent-files')).toBeUndefined()
      } finally {
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('preserves the trashed paper and its original files when another connection holds the write lock', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-locked-'))
      const dbPath = path.join(tmpDir, 'app.db')
      const db = openDb({ path: dbPath })
      const writer = openDb({ path: dbPath })
      try {
        const slug = 'locked-paper'
        const paperDir = path.join(tmpDir, 'papers', slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
        fs.writeFileSync(path.join(paperDir, 'paper.md'), '# Original paper')
        upsertPaper(db, makeRecord({ slug }))
        const original = trashPaper(db, slug)
        db.pragma('busy_timeout = 0')
        writer.exec('BEGIN IMMEDIATE')

        expect(() => purgePaper(db, slug, tmpDir)).toThrow(/database is locked/)

        expect(getPaper(db, slug)).toEqual(original)
        expect(listPapers(db, { trashed: true })).toEqual([original])
        expect(fs.readFileSync(path.join(paperDir, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
        expect(fs.readFileSync(path.join(paperDir, 'paper.md'), 'utf8')).toBe('# Original paper')
      } finally {
        if (writer.inTransaction) writer.exec('ROLLBACK')
        writer.close()
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('restores original files and research state when the database commit fails', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-commit-'))
      const db = openDb({ path: path.join(tmpDir, 'app.db') })
      try {
        const slug = 'commit-failure'
        const paperDir = path.join(tmpDir, 'papers', slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
        fs.writeFileSync(path.join(paperDir, 'paper.md'), '# Original paper')
        upsertPaper(db, makeRecord({ slug }))
        const original = trashPaper(db, slug)
        const note = upsertNote(db, slug, 'Keep my research notes')
        // DELETE succeeds, but this deferred constraint rejects COMMIT.
        db.exec(`
          CREATE TABLE purge_commit_guard (
            paper_slug TEXT REFERENCES papers(slug) DEFERRABLE INITIALLY DEFERRED
          );
          INSERT INTO purge_commit_guard (paper_slug) VALUES ('commit-failure');
        `)

        expect(() => purgePaper(db, slug, tmpDir)).toThrow(/FOREIGN KEY constraint failed/)

        expect(db.inTransaction).toBe(false)
        expect(getPaper(db, slug)).toEqual(original)
        expect(getNote(db, slug)).toEqual(note)
        expect(fs.readFileSync(path.join(paperDir, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
        expect(fs.readFileSync(path.join(paperDir, 'paper.md'), 'utf8')).toBe('# Original paper')
        expect(fs.readdirSync(path.join(tmpDir, 'papers'))).toEqual([slug])
        const reopened = openDb({ path: path.join(tmpDir, 'app.db') })
        try {
          expect(getPaper(reopened, slug)).toEqual(original)
          expect(getNote(reopened, slug)).toEqual(note)
        } finally {
          reopened.close()
        }
      } finally {
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('preserves original files and research state when a DELETE trigger rejects purge', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-delete-'))
      try {
        const slug = 'delete-failure'
        const paperDir = path.join(tmpDir, 'papers', slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
        fs.writeFileSync(path.join(paperDir, 'paper.md'), '# Original paper')
        upsertPaper(db, makeRecord({ slug }))
        const original = trashPaper(db, slug)
        const note = upsertNote(db, slug, 'Keep my research notes')
        db.exec(`
          CREATE TRIGGER reject_purge BEFORE DELETE ON papers
          BEGIN SELECT RAISE(ABORT, 'purge rejected'); END;
        `)

        expect(() => purgePaper(db, slug, tmpDir)).toThrow('purge rejected')

        expect(db.inTransaction).toBe(false)
        expect(getPaper(db, slug)).toEqual(original)
        expect(getNote(db, slug)).toEqual(note)
        expect(fs.readFileSync(path.join(paperDir, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
        expect(fs.readFileSync(path.join(paperDir, 'paper.md'), 'utf8')).toBe('# Original paper')
        expect(fs.readdirSync(path.join(tmpDir, 'papers'))).toEqual([slug])
      } finally {
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('rejects purge inside an outer transaction that could later roll back', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-nested-'))
      try {
        const slug = 'nested-purge'
        const paperDir = path.join(tmpDir, 'papers', slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
        upsertPaper(db, makeRecord({ slug }))
        const original = trashPaper(db, slug)
        db.exec('BEGIN IMMEDIATE')

        expect(() => purgePaper(db, slug, tmpDir)).toThrow(/outside an existing transaction/)

        expect(db.inTransaction).toBe(true)
        db.exec('ROLLBACK')
        expect(getPaper(db, slug)).toEqual(original)
        expect(fs.readFileSync(path.join(paperDir, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
      } finally {
        if (db.inTransaction) db.exec('ROLLBACK')
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it.each(['lstatSync', 'mkdtempSync', 'renameSync'] as const)(
      'preserves files and research state when filesystem %s fails',
      (operation) => {
        const db = openDb({ path: ':memory:' })
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-filesystem-'))
        try {
          const slug = 'filesystem-failure'
          const paperDir = path.join(tmpDir, 'papers', slug)
          fs.mkdirSync(paperDir, { recursive: true })
          fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
          fs.writeFileSync(path.join(paperDir, 'paper.md'), '# Original paper')
          upsertPaper(db, makeRecord({ slug }))
          const original = trashPaper(db, slug)
          const note = upsertNote(db, slug, 'Keep my research notes')
          const failure = new Error('filesystem unavailable')
          vi.spyOn(fs, operation).mockImplementationOnce(() => { throw failure })

          expect(() => purgePaper(db, slug, tmpDir)).toThrow(failure)

          expect(db.inTransaction).toBe(false)
          expect(getPaper(db, slug)).toEqual(original)
          expect(getNote(db, slug)).toEqual(note)
          expect(fs.readFileSync(path.join(paperDir, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
          expect(fs.readFileSync(path.join(paperDir, 'paper.md'), 'utf8')).toBe('# Original paper')
          expect(fs.readdirSync(path.join(tmpDir, 'papers'))).toEqual([slug])
        } finally {
          vi.restoreAllMocks()
          db.close()
          fs.rmSync(tmpDir, { recursive: true, force: true })
        }
      },
    )

    it('returns committed success with a recovery-path warning when cleanup partially fails', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-cleanup-'))
      try {
        const slug = 'cleanup-failure'
        const papersRoot = path.join(tmpDir, 'papers')
        const paperDir = path.join(papersRoot, slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
        fs.writeFileSync(path.join(paperDir, 'paper.md'), '# Original paper')
        upsertPaper(db, makeRecord({ slug }))
        upsertNote(db, slug, 'Research notes')
        const failure = new Error('cleanup interrupted')
        vi.spyOn(fs, 'rmSync').mockImplementationOnce((directory) => {
          fs.unlinkSync(path.join(String(directory), slug, 'paper.md'))
          throw failure
        })
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(purgePaper(db, slug, tmpDir)).toBe(true)

        expect(getPaper(db, slug)).toBeUndefined()
        expect(getNote(db, slug)).toBeUndefined()
        expect(fs.existsSync(paperDir)).toBe(false)
        const remaining = fs.readdirSync(papersRoot)
        expect(remaining).toHaveLength(1)
        const recoveryDir = path.join(papersRoot, remaining[0]!)
        expect(fs.readFileSync(path.join(recoveryDir, slug, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
        expect(warning).toHaveBeenCalledWith(
          `Paper purge committed, but recovery-file cleanup failed at ${recoveryDir}`,
          failure,
        )
      } finally {
        vi.restoreAllMocks()
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('retains the recovery files and reports their path if restoring after rollback also fails', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-restore-'))
      try {
        const slug = 'restore-failure'
        const papersRoot = path.join(tmpDir, 'papers')
        const paperDir = path.join(papersRoot, slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'original pdf bytes')
        fs.writeFileSync(path.join(paperDir, 'paper.md'), '# Original paper')
        upsertPaper(db, makeRecord({ slug }))
        const original = trashPaper(db, slug)
        const note = upsertNote(db, slug, 'Keep my research notes')
        db.exec(`
          CREATE TABLE purge_commit_guard (
            paper_slug TEXT REFERENCES papers(slug) DEFERRABLE INITIALLY DEFERRED
          );
          INSERT INTO purge_commit_guard (paper_slug) VALUES ('restore-failure');
        `)
        const rename = fs.renameSync
        vi.spyOn(fs, 'renameSync')
          .mockImplementationOnce(rename)
          .mockImplementationOnce(() => { throw new Error('restore unavailable') })

        expect(() => purgePaper(db, slug, tmpDir)).toThrow(/original files could not be restored and remain at/)

        expect(db.inTransaction).toBe(false)
        expect(getPaper(db, slug)).toEqual(original)
        expect(getNote(db, slug)).toEqual(note)
        const remaining = fs.readdirSync(papersRoot)
        expect(remaining).toHaveLength(1)
        const recoveryPath = path.join(papersRoot, remaining[0]!, slug)
        expect(fs.readFileSync(path.join(recoveryPath, 'paper.pdf'), 'utf8')).toBe('original pdf bytes')
        expect(fs.readFileSync(path.join(recoveryPath, 'paper.md'), 'utf8')).toBe('# Original paper')
      } finally {
        vi.restoreAllMocks()
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('permanently purges an arXiv paper with a dotted slug from DB and removes its directory on disk', () => {
      const db = openDb({ path: ':memory:' })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-purge-arxiv-'))
      try {
        const slug = 'arxiv-2401.12345'
        const paperDir = path.join(tmpDir, 'papers', slug)
        fs.mkdirSync(paperDir, { recursive: true })
        fs.writeFileSync(path.join(paperDir, 'paper.pdf'), 'fake pdf')

        upsertPaper(db, makeRecord({ slug, title: 'Attention Is All You Need, Again' }))
        expect(getPaper(db, slug)).toBeDefined()

        const purged = purgePaper(db, slug, tmpDir)
        expect(purged).toBe(true)
        expect(getPaper(db, slug)).toBeUndefined()
        expect(fs.existsSync(paperDir)).toBe(false)
      } finally {
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('purgePaper prevents path traversal in slug', () => {
      const db = openDb({ path: ':memory:' })
      try {
        expect(() => purgePaper(db, '../traversal')).toThrow(/Invalid slug format/)
      } finally {
        db.close()
      }
    })

    it.each([
      ['parent traversal ..', '..'],
      ['relative traversal ../etc', '../etc'],
      ['nested traversal ../../etc/passwd', '../../etc/passwd'],
      ['absolute root path /etc/passwd', '/etc/passwd'],
      ['absolute path inside papers', '/tmp/papers/foo'],
      ['empty string', ''],
      ['hidden dotfile .hidden', '.hidden'],
      ['leading dot .arxiv-123', '.arxiv-123'],
      ['leading dash -paper', '-paper'],
      ['leading underscore _paper', '_paper'],
      ['spaces in slug', 'slug with spaces'],
      ['forward slash', 'foo/bar'],
      ['backward slash', 'foo\\bar'],
      ['null byte', 'foo\0bar'],
    ])('purgePaper rejects malformed or hostile slug: %s (%j)', (_desc, hostileSlug) => {
      const db = openDb({ path: ':memory:' })
      try {
        expect(() => purgePaper(db, hostileSlug)).toThrow(/Invalid slug format/)
      } finally {
        db.close()
      }
    })

    describe('canonical slug validation helper', () => {
      it.each([
        'arxiv-2401.12345',
        'arxiv-2401.12345v2',
        'doi-10.1038-s41586-021-03819-2',
        'pdf-my.paper.name-2024',
        'local-simple-name',
        'Paper_123.v1',
      ])('isValidSlug accepts valid slug: %s', (slug) => {
        expect(isValidSlug(slug)).toBe(true)
        expect(() => assertValidSlug(slug)).not.toThrow()
        expect(SLUG_PATTERN.test(slug)).toBe(true)
      })

      it.each([
        '..',
        '../etc',
        '/absolute/path',
        '',
        '.hidden',
        '-dash',
        '_underscore',
        'slug with space',
        'slug/slash',
        'slug\\backslash',
      ])('isValidSlug rejects invalid slug: %j', (slug) => {
        expect(isValidSlug(slug)).toBe(false)
        expect(() => assertValidSlug(slug)).toThrow(/Invalid slug format/)
      })

      it('isValidSlug returns false for non-string types', () => {
        expect(isValidSlug(null)).toBe(false)
        expect(isValidSlug(undefined)).toBe(false)
        expect(isValidSlug(12345)).toBe(false)
        expect(isValidSlug({})).toBe(false)
      })
    })
  })
})
