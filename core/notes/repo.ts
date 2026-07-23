// Notes CRUD against the `notes` table (core/store/schema.ts SCHEMA_V3_NOTES,
// migration 3). [P2-01] Notes tab: one freeform markdown note per paper,
// edited in a right-panel editor with autosave.
//
// `paper_slug` is the table's PRIMARY KEY, not a separate id — one note per
// paper is the whole model, so the natural key doubles as the uniqueness
// constraint. That makes autosave a plain upsert-by-paper-slug (same shape
// as core/library/repo.ts's upsertPaper): the caller never juggles a note id,
// it always addresses a note by the paper it belongs to. `ON DELETE CASCADE`
// on the papers FK means deleting a paper drops its note automatically.
//
// Storage split reminder (AGENTS.md): `body` is the note's own markdown text
// (state the user typed), not the paper's markdown — the source paper's
// paper.md never passes through this module.

import type { Database } from 'better-sqlite3'

export interface NoteRecord {
  paperSlug: string
  body: string
  updatedAt: string
}

interface NoteRow {
  paper_slug: string
  body: string
  updated_at: string
}

function toRecord(row: NoteRow): NoteRecord {
  return {
    paperSlug: row.paper_slug,
    body: row.body,
    updatedAt: row.updated_at,
  }
}

/** Fetch the note for a paper, or undefined if none has been saved yet. */
export function getNote(db: Database, paperSlug: string): NoteRecord | undefined {
  const row = db.prepare('SELECT * FROM notes WHERE paper_slug = ?').get(paperSlug) as NoteRow | undefined
  return row ? toRecord(row) : undefined
}

/**
 * Create or overwrite the note for a paper — autosave's persistence half.
 * `paper_slug` being the PRIMARY KEY makes this a single `ON CONFLICT`
 * upsert, no separate "does a note already exist" read needed first.
 */
export function upsertNote(db: Database, paperSlug: string, body: string): NoteRecord {
  const updatedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO notes (paper_slug, body, updated_at)
     VALUES (@paperSlug, @body, @updatedAt)
     ON CONFLICT(paper_slug) DO UPDATE SET
       body       = excluded.body,
       updated_at = excluded.updated_at`,
  ).run({ paperSlug, body, updatedAt })
  return { paperSlug, body, updatedAt }
}

/** Delete a paper's note, if one exists. No-op if there isn't one. */
export function deleteNote(db: Database, paperSlug: string): void {
  db.prepare('DELETE FROM notes WHERE paper_slug = ?').run(paperSlug)
}
