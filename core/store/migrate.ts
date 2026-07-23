// Tiny numbered-migration runner for Vellum's SQLite store.
//
// Design: each migration is a plain `{ version, sql }` pair, applied in
// ascending order inside one transaction each. Applied versions are tracked
// via SQLite's built-in `user_version` pragma — no extra bookkeeping table
// needed, and it's atomic with the schema change itself (same connection,
// same transaction boundary per migration).
//
// Numbering: version 1 == SCHEMA_V1 (the baseline tables). Future schema
// growth appends `{ version: 2, sql: ... }` etc. Never edit a landed
// migration's SQL in place — append a new one.

import type { Database } from 'better-sqlite3'

import { SCHEMA_V1, SCHEMA_V3_NOTES, SCHEMA_V4_HIGHLIGHTS } from './schema.js'

export interface Migration {
  version: number
  sql: string
}

/** Ordered migration list. Append new entries; never reorder or edit landed ones. */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: 'ALTER TABLE papers ADD COLUMN summary TEXT;' },
  { version: 3, sql: SCHEMA_V3_NOTES }, // [P2-01] notes table
  { version: 4, sql: SCHEMA_V4_HIGHLIGHTS }, // [P2-02] highlights table
]

/**
 * Apply every migration newer than the DB's current `user_version`, in
 * order, each inside its own transaction. Idempotent: re-running against an
 * already-current DB is a no-op (no statements execute).
 */
export function runMigrations(db: Database, migrations: Migration[] = MIGRATIONS): void {
  const applied = db.pragma('user_version', { simple: true }) as number

  const pending = migrations
    .filter((m) => m.version > applied)
    .sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      // `user_version` cannot be bound as a parameter; the value here is a
      // trusted integer from our own MIGRATIONS array, never user input.
      db.pragma(`user_version = ${migration.version}`)
    })
    apply()
  }
}
