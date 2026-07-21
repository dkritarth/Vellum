import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openDb } from './db.js'

describe('openDb', () => {
  let tmpDir: string | undefined

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = undefined
    }
  })

  it('opens an in-memory DB and applies schema', () => {
    const db = openDb({ path: ':memory:' })
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name)
      expect(tables).toEqual(
        expect.arrayContaining(['papers', 'collections', 'chat_sessions', 'chat_messages']),
      )
    } finally {
      db.close()
    }
  })

  it('creates the containing directory if missing, at a temp path', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-db-test-'))
    const dbPath = join(tmpDir, 'nested', 'dir', 'app.db')
    expect(existsSync(join(tmpDir, 'nested'))).toBe(false)

    const db = openDb({ path: dbPath })
    try {
      expect(existsSync(dbPath)).toBe(true)
    } finally {
      db.close()
    }
  })

  it('applying schema twice (two opens of the same file) is idempotent', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-db-test-'))
    const dbPath = join(tmpDir, 'app.db')

    const db1 = openDb({ path: dbPath })
    db1.prepare(
      `INSERT INTO papers (slug, title, added_at) VALUES ('p1', 'Paper One', '2026-01-01')`,
    ).run()
    db1.close()

    // Re-opening (e.g. next app launch) must not error and must preserve data.
    const db2 = openDb({ path: dbPath })
    try {
      const row = db2.prepare('SELECT * FROM papers WHERE slug = ?').get('p1')
      expect(row).toBeTruthy()
      const version = db2.pragma('user_version', { simple: true })
      expect(version).toBe(2)
    } finally {
      db2.close()
    }
  })
})
