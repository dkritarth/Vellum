import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openDb } from '../store/db.js'
import { upsertPaper } from '../library/repo.js'
import { deleteNote, getNote, upsertNote } from './repo.js'

describe('notes repo', () => {
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

  it('returns undefined when a paper has no note yet', () => {
    expect(getNote(db, 'attention-is-all-you-need')).toBeUndefined()
  })

  it('creates a note and reads it back', () => {
    const created = upsertNote(db, 'attention-is-all-you-need', '# scratch notes')
    expect(created.paperSlug).toBe('attention-is-all-you-need')
    expect(created.body).toBe('# scratch notes')

    const note = getNote(db, 'attention-is-all-you-need')
    expect(note).toMatchObject({ paperSlug: 'attention-is-all-you-need', body: '# scratch notes' })
  })

  it('upserting the same paper overwrites the body in place, no duplicate row', () => {
    upsertNote(db, 'attention-is-all-you-need', 'first draft')
    upsertNote(db, 'attention-is-all-you-need', 'second draft')

    const note = getNote(db, 'attention-is-all-you-need')
    expect(note?.body).toBe('second draft')

    const rows = db.prepare('SELECT COUNT(*) as n FROM notes').get() as { n: number }
    expect(rows.n).toBe(1)
  })

  it('upsert (autosave) bumps updated_at', () => {
    const first = upsertNote(db, 'attention-is-all-you-need', 'v1')
    const second = upsertNote(db, 'attention-is-all-you-need', 'v2')
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime())
  })

  it('deletes a note', () => {
    upsertNote(db, 'attention-is-all-you-need', 'to be deleted')
    deleteNote(db, 'attention-is-all-you-need')
    expect(getNote(db, 'attention-is-all-you-need')).toBeUndefined()
  })

  it('deleting a note that does not exist is a no-op', () => {
    expect(() => deleteNote(db, 'no-such-paper')).not.toThrow()
  })

  it('deleting the paper cascades and removes its note', () => {
    upsertNote(db, 'attention-is-all-you-need', 'cascade me')
    db.prepare('DELETE FROM papers WHERE slug = ?').run('attention-is-all-you-need')
    expect(getNote(db, 'attention-is-all-you-need')).toBeUndefined()
  })

  it('persists across restart (reopen DB)', () => {
    let tmpDir: string | undefined
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'vellum-notes-test-'))
      const dbPath = join(tmpDir, 'app.db')

      const db1 = openDb({ path: dbPath })
      upsertPaper(db1, {
        slug: 'attention-is-all-you-need',
        title: 'Attention Is All You Need',
        authors: ['A. Vaswani'],
        addedAt: new Date().toISOString(),
      })
      upsertNote(db1, 'attention-is-all-you-need', 'persisted note')
      db1.close()

      const db2 = openDb({ path: dbPath })
      try {
        expect(getNote(db2, 'attention-is-all-you-need')).toMatchObject({ body: 'persisted note' })
      } finally {
        db2.close()
      }
    } finally {
      if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
