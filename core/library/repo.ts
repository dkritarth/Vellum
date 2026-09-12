import fs from 'node:fs'
import path from 'node:path'
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
  /** [P2-04] ORCIDs positionally aligned to `authors` — entry `i` is the bare
   * ORCID id (e.g. `0000-0002-1825-0097`) for `authors[i]`, or `null` when
   * that specific author's ORCID is unknown. `undefined` when no ORCID data
   * is known for this paper at all (column is NULL — predates this feature
   * or was never supplied), as distinct from an array of all-null entries. */
  authorOrcids?: (string | null)[]
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  abstract?: string
  summary?: string
  mdPath?: string
  pdfPath?: string
  /** Section outline from core/ingest/extract.ts's ExtractResult.sections. */
  sections?: unknown[]
  addedAt: string
  /** [L2-04] Timestamp when paper was moved to Trash; undefined/null if active. */
  trashedAt?: string | null
}

interface PaperRow {
  slug: string
  title: string
  authors: string | null
  author_orcids: string | null
  year: number | null
  venue: string | null
  doi: string | null
  arxiv_id: string | null
  abstract: string | null
  summary: string | null
  md_path: string | null
  pdf_path: string | null
  sections: string | null
  added_at: string
  trashed_at: string | null
}

function toRecord(row: PaperRow): PaperRecord {
  return {
    slug: row.slug,
    title: row.title,
    authors: row.authors ? (JSON.parse(row.authors) as string[]) : [],
    authorOrcids: row.author_orcids
      ? (JSON.parse(row.author_orcids) as (string | null)[])
      : undefined,
    year: row.year ?? undefined,
    venue: row.venue ?? undefined,
    doi: row.doi ?? undefined,
    arxivId: row.arxiv_id ?? undefined,
    abstract: row.abstract ?? undefined,
    summary: row.summary ?? undefined,
    mdPath: row.md_path ?? undefined,
    pdfPath: row.pdf_path ?? undefined,
    sections: row.sections ? (JSON.parse(row.sections) as unknown[]) : [],
    addedAt: row.added_at,
    trashedAt: row.trashed_at ?? undefined,
  }
}

/**
 * Insert a paper row, or overwrite it in place if `slug` already exists
 * (re-ingest). Never produces a duplicate row for the same slug — this is
 * the idempotency guarantee [P1-06] requires of `ingest()`.
 */
export function upsertPaper(db: Database, paper: PaperRecord): void {
  db.prepare(
    `INSERT INTO papers (slug, title, authors, author_orcids, year, venue, doi, arxiv_id, abstract, summary, md_path, pdf_path, sections, added_at, trashed_at)
     VALUES (@slug, @title, @authors, @authorOrcids, @year, @venue, @doi, @arxivId, @abstract, @summary, @mdPath, @pdfPath, @sections, @addedAt, @trashedAt)
     ON CONFLICT(slug) DO UPDATE SET
       title         = excluded.title,
       authors       = excluded.authors,
       author_orcids = excluded.author_orcids,
       year          = excluded.year,
       venue         = excluded.venue,
       doi           = excluded.doi,
       arxiv_id      = excluded.arxiv_id,
       abstract      = excluded.abstract,
       summary       = excluded.summary,
       md_path       = excluded.md_path,
       pdf_path      = excluded.pdf_path,
       sections      = excluded.sections,
       added_at      = excluded.added_at,
       trashed_at    = excluded.trashed_at`,
  ).run({
    slug: paper.slug,
    title: paper.title,
    authors: JSON.stringify(paper.authors ?? []),
    authorOrcids: paper.authorOrcids !== undefined ? JSON.stringify(paper.authorOrcids) : null,
    year: paper.year ?? null,
    venue: paper.venue ?? null,
    doi: paper.doi ?? null,
    arxivId: paper.arxivId ?? null,
    abstract: paper.abstract ?? null,
    summary: paper.summary ?? null,
    mdPath: paper.mdPath ?? null,
    pdfPath: paper.pdfPath ?? null,
    sections: JSON.stringify(paper.sections ?? []),
    addedAt: paper.addedAt,
    trashedAt: paper.trashedAt ?? null,
  })
}

/** Fetch one paper by slug, or undefined if no row exists. */
export function getPaper(db: Database, slug: string): PaperRecord | undefined {
  const row = db.prepare('SELECT * FROM papers WHERE slug = ?').get(slug) as PaperRow | undefined
  return row ? toRecord(row) : undefined
}

/** Sortable columns exposed to callers — the only columns `listPapers` will
 * ever place in an `ORDER BY` clause. */
export type PaperSortColumn = 'addedAt' | 'year' | 'title'

/** `PaperSortColumn` -> actual SQL column name. This is the ONLY place a sort
 * column reaches the query string, and it always comes from this map's
 * values (fixed string literals), never from `options.sort` directly — an
 * unrecognized/hostile value (e.g. smuggled through the `vellum:list-papers`
 * IPC channel as untyped `unknown`) falls through to the `addedAt` default
 * below rather than ever being interpolated. Sort-column SQL injection is a
 * real class of bug; this map is the fix. */
const SORT_COLUMNS: Record<PaperSortColumn, string> = {
  addedAt: 'added_at',
  year: 'year',
  title: 'title',
}

export interface ListPapersOptions {
  /** Case-insensitive substring match against title. Omitted/empty = no filter. */
  search?: string
  /** Filter papers belonging to a specific collection. Omitted/undefined = all collections. */
  collectionId?: number
  /** Column to sort by. Defaults to `addedAt`. */
  sort?: PaperSortColumn
  /** Sort direction. Defaults to `desc`. */
  order?: 'asc' | 'desc'
  /** [L2-04] If true, lists only trashed papers. If false/omitted, excludes trashed papers. */
  trashed?: boolean
}

/** Escape SQLite LIKE metacharacters (`%`, `_`) plus the escape char itself
 * so a search term is matched literally — a title containing a real `%` or
 * `_` shouldn't act as a wildcard. Paired with `ESCAPE '\'` in the query. */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * Papers for the library grid — optionally filtered by title substring and
 * sorted by a whitelisted column. Defaults to all papers, most-recently-added
 * first (same behavior as the pre-[P1-08] base query).
 *
 * `options.sort` is resolved through `SORT_COLUMNS` (never interpolated
 * directly) and `options.search` is passed as a bound parameter with LIKE
 * metacharacters escaped — this function is safe to call with a caller-typed
 * `options` object even if it originated as `unknown` at an IPC boundary.
 */
export function listPapers(db: Database, options: ListPapersOptions = {}): PaperRecord[] {
  const sortColumn = SORT_COLUMNS[options.sort as PaperSortColumn] ?? SORT_COLUMNS.addedAt
  const direction = options.order === 'asc' ? 'ASC' : 'DESC'
  const search = typeof options.search === 'string' ? options.search.trim() : ''
  const collectionId = typeof options.collectionId === 'number' ? options.collectionId : undefined

  let sql = 'SELECT papers.* FROM papers'
  const params: unknown[] = []
  const conditions: string[] = []

  if (options.trashed) {
    conditions.push('papers.trashed_at IS NOT NULL')
  } else {
    conditions.push('papers.trashed_at IS NULL')
  }

  if (collectionId !== undefined) {
    sql += ' JOIN paper_collections pc ON pc.paper_slug = papers.slug'
    conditions.push('pc.collection_id = ?')
    params.push(collectionId)
  }

  if (search) {
    conditions.push("papers.title LIKE ? ESCAPE '\\'")
    params.push(`%${escapeLikeTerm(search)}%`)
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }

  sql += ` ORDER BY papers.${sortColumn} ${direction}`

  const rows = db.prepare(sql).all(...params) as PaperRow[]
  return rows.map(toRecord)
}

/** [L2-04] Move a paper to Trash (soft delete). */
export function trashPaper(db: Database, slug: string): PaperRecord | undefined {
  const now = new Date().toISOString()
  db.prepare('UPDATE papers SET trashed_at = ? WHERE slug = ?').run(now, slug)
  return getPaper(db, slug)
}

/** [L2-04] Restore a paper from Trash back to active Library. */
export function restorePaper(db: Database, slug: string): PaperRecord | undefined {
  db.prepare('UPDATE papers SET trashed_at = NULL WHERE slug = ?').run(slug)
  return getPaper(db, slug)
}

/**
 * [L2-04] Permanently purge a paper from SQLite and delete its on-disk assets.
 * Cascades to notes, highlights, chats, collections, and questions.
 */
export function purgePaper(db: Database, slug: string, libraryDir?: string): boolean {
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error(`Invalid slug format: ${slug}`)
  }

  const paper = getPaper(db, slug)
  if (!paper) return false

  if (libraryDir) {
    const targetDir = path.resolve(libraryDir, 'papers', slug)
    const papersRoot = path.resolve(libraryDir, 'papers')
    if (!targetDir.startsWith(papersRoot + path.sep)) {
      throw new Error(`Path traversal detected: ${targetDir}`)
    }
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }
    } catch (err) {
      throw new Error(`Failed to remove paper files from disk: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const result = db.prepare('DELETE FROM papers WHERE slug = ?').run(slug)
  return result.changes > 0
}
