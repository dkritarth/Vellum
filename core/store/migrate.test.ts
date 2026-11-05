import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { runMigrations, type Migration } from './migrate.js'

describe('runMigrations', () => {
  let db: Database.Database
  let tempDir: string | undefined

  afterEach(() => {
    db?.close()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('applies the real MIGRATIONS list and creates every SCHEMA_V1 table', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tables).toEqual(
      expect.arrayContaining([
        'papers',
        'collections',
        'paper_collections',
        'chat_sessions',
        'chat_messages',
        'notes',
        'highlights',
        'suggested_questions',
      ]),
    )
  })

  it('records the applied version via user_version', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(8)
  })

  it('adds the author_orcids column to papers [P2-04]', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const columns = db
      .prepare("PRAGMA table_info(papers)")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(columns).toContain('author_orcids')
  })

  it('creates the highlights table index', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'highlights'")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(indexes).toContain('idx_highlights_paper')
  })

  it('re-running is a no-op: applying twice does not error or reset data', () => {
    db = new Database(':memory:')
    runMigrations(db)

    db.prepare(
      `INSERT INTO papers (slug, title, added_at) VALUES ('a', 'Title A', '2026-01-01')`,
    ).run()

    // Re-run against an already-current DB.
    runMigrations(db)

    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(8)

    const row = db.prepare('SELECT * FROM papers WHERE slug = ?').get('a')
    expect(row).toBeTruthy()
  })


  it('creates the suggested_questions table and index [L2-03]', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toContain('suggested_questions')

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'suggested_questions'")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(indexes).toContain('idx_suggested_questions_paper')
  })


  it('adds the trashed_at column to papers [L2-04]', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const columns = db
      .prepare("PRAGMA table_info(papers)")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(columns).toContain('trashed_at')
  })

  it('creates the usage_records table and indexes [L2-05]', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toContain('usage_records')

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'usage_records'")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(indexes).toContain('idx_usage_records_backend')
    expect(indexes).toContain('idx_usage_records_recorded_at')
    expect(indexes).toContain('idx_usage_records_session')
  })

  it('applies only migrations newer than the current version, in order', () => {
    db = new Database(':memory:')

    const calls: number[] = []
    const migrations: Migration[] = [
      { version: 1, sql: 'CREATE TABLE t1 (x INTEGER);' },
      { version: 2, sql: 'CREATE TABLE t2 (x INTEGER);' },
      { version: 3, sql: 'CREATE TABLE t3 (x INTEGER);' },
    ]

    runMigrations(db, [migrations[0]!])
    calls.push(db.pragma('user_version', { simple: true }) as number)

    // Simulate an app upgrade: same DB, now offering the full migration set.
    runMigrations(db, migrations)
    calls.push(db.pragma('user_version', { simple: true }) as number)

    expect(calls).toEqual([1, 3])

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(['t1', 't2', 't3'])
  })

  it('does not re-execute an already-applied migration (idempotent per version)', () => {
    db = new Database(':memory:')
    const migrations: Migration[] = [{ version: 1, sql: 'CREATE TABLE once_only (x INTEGER);' }]

    runMigrations(db, migrations)
    // A second run with the same migration list must not attempt to
    // re-CREATE the table (which would throw without IF NOT EXISTS).
    expect(() => runMigrations(db, migrations)).not.toThrow()
  })

  it('preserves committed upgrades after failure and durably retries the corrected version once', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'vellum-migration-test-'))
    const dbPath = join(tempDir, 'app.db')
    db = new Database(dbPath)

    const baseline: Migration = {
      version: 1,
      sql: `
        CREATE TABLE entries (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
        INSERT INTO entries VALUES (1, 'Original seed');
      `,
    }
    const earlierUpgrade: Migration = {
      version: 2,
      sql: "INSERT INTO entries VALUES (2, 'Earlier upgrade');",
    }
    const correctedUpgrade: Migration = {
      version: 3,
      sql: `
        CREATE TABLE upgrade_notes (entry_id INTEGER PRIMARY KEY, note TEXT NOT NULL);
        INSERT INTO upgrade_notes VALUES (1, 'Review seed');
        UPDATE entries SET title = 'Updated by upgrade' WHERE id = 2;
        INSERT INTO entries VALUES (3, 'New entry');
      `,
    }
    const failedUpgrade: Migration = {
      version: 3,
      sql: `${correctedUpgrade.sql}
        INSERT INTO entries VALUES (1, 'Duplicate seed');
      `,
    }
    const laterUpgrade: Migration = {
      version: 4,
      sql: 'CREATE TABLE later_upgrade (id INTEGER PRIMARY KEY);',
    }

    runMigrations(db, [baseline])
    expect(() => runMigrations(db, [baseline, earlierUpgrade, failedUpgrade, laterUpgrade]))
      .toThrow(/UNIQUE constraint failed: entries.id/)

    const expectCommittedState = () => {
      expect(db.pragma('user_version', { simple: true })).toBe(2)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all())
        .toEqual([{ name: 'entries' }])
      expect(db.prepare('SELECT id, title FROM entries ORDER BY id').all()).toEqual([
        { id: 1, title: 'Original seed' },
        { id: 2, title: 'Earlier upgrade' },
      ])
    }

    // Both the current connection and a fresh open must see only committed work.
    expectCommittedState()
    db.close()
    db = new Database(dbPath)
    expectCommittedState()

    const correctedMigrations = [baseline, earlierUpgrade, correctedUpgrade, laterUpgrade]
    runMigrations(db, correctedMigrations)
    db.close()
    db = new Database(dbPath)

    const expectRecoveredState = () => {
      expect(db.pragma('user_version', { simple: true })).toBe(4)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all())
        .toEqual([{ name: 'entries' }, { name: 'later_upgrade' }, { name: 'upgrade_notes' }])
      expect(db.prepare('SELECT id, title FROM entries ORDER BY id').all()).toEqual([
        { id: 1, title: 'Original seed' },
        { id: 2, title: 'Updated by upgrade' },
        { id: 3, title: 'New entry' },
      ])
      expect(db.prepare('SELECT entry_id, note FROM upgrade_notes').all())
        .toEqual([{ entry_id: 1, note: 'Review seed' }])
    }

    expectRecoveredState()
    // Non-idempotent CREATE/INSERT statements must be skipped on another run.
    runMigrations(db, correctedMigrations)
    db.close()
    db = new Database(dbPath)
    expectRecoveredState()
  })
})
