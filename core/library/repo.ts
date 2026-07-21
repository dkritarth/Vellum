// Paper CRUD against the `papers` table (core/store/schema.ts SCHEMA_V1).
// Owns all SQL for the papers table — parameterized statements only, no
// string interpolation of caller-supplied values. This is the storage seam
// [P1-06]'s ingest orchestrator (core/ingest/index.ts) writes through; the
// orchestrator never talks SQL directly.
//
// Storage split reminder (see AGENTS.md): this module persists metadata +
// file paths only. Paper markdown/PDF bytes never pass through here — they
// go straight to disk in core/ingest/index.ts.

import type { Database } from 'better-sqlite3'

/** In-memory shape of a `papers` row — JSON columns (authors, sections)
 * already parsed/serialized at this boundary so callers never touch raw
 * SQLite TEXT-encoded JSON. */
export interface PaperRecord {
  slug: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  abstract?: string
  mdPath?: string
  pdfPath?: string
  /** Section outline from core/ingest/extract.ts's ExtractResult.sections. */
  sections?: unknown[]
  addedAt: string
}

interface PaperRow {
  slug: string
  title: string
  authors: string | null
  year: number | null
  venue: string | null
  doi: string | null
  arxiv_id: string | null
  abstract: string | null
  md_path: string | null
  pdf_path: string | null
  sections: string | null
  added_at: string
}

function toRecord(row: PaperRow): PaperRecord {
  return {
    slug: row.slug,
    title: row.title,
    authors: row.authors ? (JSON.parse(row.authors) as string[]) : [],
    year: row.year ?? undefined,
    venue: row.venue ?? undefined,
    doi: row.doi ?? undefined,
    arxivId: row.arxiv_id ?? undefined,
    abstract: row.abstract ?? undefined,
    mdPath: row.md_path ?? undefined,
    pdfPath: row.pdf_path ?? undefined,
    sections: row.sections ? (JSON.parse(row.sections) as unknown[]) : [],
    addedAt: row.added_at,
  }
}

/**
 * Insert a paper row, or overwrite it in place if `slug` already exists
 * (re-ingest). Never produces a duplicate row for the same slug — this is
 * the idempotency guarantee [P1-06] requires of `ingest()`.
 */
export function upsertPaper(db: Database, paper: PaperRecord): void {
  db.prepare(
    `INSERT INTO papers (slug, title, authors, year, venue, doi, arxiv_id, abstract, md_path, pdf_path, sections, added_at)
     VALUES (@slug, @title, @authors, @year, @venue, @doi, @arxivId, @abstract, @mdPath, @pdfPath, @sections, @addedAt)
     ON CONFLICT(slug) DO UPDATE SET
       title     = excluded.title,
       authors   = excluded.authors,
       year      = excluded.year,
       venue     = excluded.venue,
       doi       = excluded.doi,
       arxiv_id  = excluded.arxiv_id,
       abstract  = excluded.abstract,
       md_path   = excluded.md_path,
       pdf_path  = excluded.pdf_path,
       sections  = excluded.sections,
       added_at  = excluded.added_at`,
  ).run({
    slug: paper.slug,
    title: paper.title,
    authors: JSON.stringify(paper.authors ?? []),
    year: paper.year ?? null,
    venue: paper.venue ?? null,
    doi: paper.doi ?? null,
    arxivId: paper.arxivId ?? null,
    abstract: paper.abstract ?? null,
    mdPath: paper.mdPath ?? null,
    pdfPath: paper.pdfPath ?? null,
    sections: JSON.stringify(paper.sections ?? []),
    addedAt: paper.addedAt,
  })
}

/** Fetch one paper by slug, or undefined if no row exists. */
export function getPaper(db: Database, slug: string): PaperRecord | undefined {
  const row = db.prepare('SELECT * FROM papers WHERE slug = ?').get(slug) as PaperRow | undefined
  return row ? toRecord(row) : undefined
}

/** All papers, most-recently-added first (library grid default order —
 * [P1-08] will add search/sort variants; this is the base query). */
export function listPapers(db: Database): PaperRecord[] {
  const rows = db.prepare('SELECT * FROM papers ORDER BY added_at DESC').all() as PaperRow[]
  return rows.map(toRecord)
}
