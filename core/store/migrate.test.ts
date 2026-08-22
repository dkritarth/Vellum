import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { runMigrations, type Migration } from './migrate.js'

describe('runMigrations', () => {
  let db: Database.Database

  afterEach(() => {
    db?.close()
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
      ]),
    )
  })

  it('records the applied version via user_version', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(3)
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
    expect(version).toBe(3)

    const row = db.prepare('SELECT * FROM papers WHERE slug = ?').get('a')
    expect(row).toBeTruthy()
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
})
