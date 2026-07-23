// Highlights CRUD against the `highlights` table (core/store/schema.ts
// SCHEMA_V4_HIGHLIGHTS, migration 4). [P2-02] Highlight tool + Annotations
// tab: multiple highlights per paper, each pinned to a PDF page.
//
// Unlike notes (one row per paper, `paper_slug` as PRIMARY KEY), a paper can
// have many highlights, so this table uses a synthetic, caller-supplied `id`
// (uuid) as its primary key. The caller also supplies `createdAt` (ISO
// string) rather than this module stamping `new Date()` itself, to keep
// creation deterministic and testable.
//
// `anchor` is an opaque JSON string produced by the renderer's text-layer
// selection logic (start/end offsets etc. needed to re-locate the highlight
// on the page). This module stores it verbatim and never parses it — same
// "state vs. content" boundary as everywhere else in core/store. `quote` is
// the exact selected text, kept alongside for the Annotations list UI and as
// a fallback re-find anchor.
//
// `ON DELETE CASCADE` on the papers FK means purging a paper drops its
// highlights automatically. There is no on-disk file counterpart for
// highlights (they only reference page numbers into the existing paper.pdf),
// so there's nothing for the file layer to coordinate on purge here.

import type { Database } from 'better-sqlite3'

export interface HighlightRecord {
  id: string
  paperSlug: string
  page: number
  color: string
  quote: string
  anchor: string
  createdAt: string
}

export interface CreateHighlightInput {
  id: string
  paperSlug: string
  page: number
  color: string
  quote: string
  anchor: string
  createdAt: string
}

interface HighlightRow {
  id: string
  paper_slug: string
  page: number
  color: string
  quote: string
  anchor: string
  created_at: string
}

function toRecord(row: HighlightRow): HighlightRecord {
  return {
    id: row.id,
    paperSlug: row.paper_slug,
    page: row.page,
    color: row.color,
    quote: row.quote,
    anchor: row.anchor,
    createdAt: row.created_at,
  }
}

/** Insert a new highlight. `id` and `createdAt` are caller-supplied for testability. */
export function createHighlight(db: Database, input: CreateHighlightInput): HighlightRecord {
  db.prepare(
    `INSERT INTO highlights (id, paper_slug, page, color, quote, anchor, created_at)
     VALUES (@id, @paperSlug, @page, @color, @quote, @anchor, @createdAt)`,
  ).run(input)

  return { ...input }
}

/** List all highlights for a paper, ordered by page then creation time ascending. */
export function listHighlights(db: Database, paperSlug: string): HighlightRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM highlights
       WHERE paper_slug = ?
       ORDER BY page ASC, created_at ASC`,
    )
    .all(paperSlug) as HighlightRow[]

  return rows.map(toRecord)
}

/** Delete a highlight by id. No-op if it doesn't exist. */
export function deleteHighlight(db: Database, id: string): void {
  db.prepare('DELETE FROM highlights WHERE id = ?').run(id)
}
