// SQLite connection bootstrap for Vellum's structured state.
//
// Storage split (locked, see AGENTS.md): SQLite holds state the UI queries
// (library, collections, chat sessions/messages); paper content itself
// stays on disk at data/papers/<slug>/{paper.md,paper.pdf}. This module only
// ever touches the state DB — never write paper markdown/PDF bytes here.

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import { runMigrations } from './migrate.js'

export interface OpenDbOptions {
  /** Override the DB file path. Defaults to `data/app.db` under `cwd`. Pass `:memory:` for tests. */
  path?: string
}

const DEFAULT_DB_PATH = 'data/app.db'

/**
 * Open (creating if needed) the Vellum state database and bring its schema
 * up to date. Safe to call repeatedly — schema application is idempotent via
 * the migration runner's `user_version` tracking.
 */
export function openDb(options: OpenDbOptions = {}): Database.Database {
  const path = options.path ?? DEFAULT_DB_PATH

  if (path !== ':memory:') {
    const dir = dirname(path)
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}
