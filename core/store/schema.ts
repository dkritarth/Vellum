// SQLite schema for Vellum's structured state.
//
// Split of concerns (locked in planning):
//   - FILES on disk  -> paper content: data/papers/<slug>/paper.pdf|paper.md
//     (the ACP agent reads these directly with its own file tools)
//   - SQLITE (this)  -> structured state the UI queries: library, tags,
//     collections, notes, highlights, chat sessions.
//
// Grow this via numbered migrations (core/store/migrations/). Keep it boring.

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS papers (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  authors     TEXT,            -- JSON array
  year        INTEGER,
  venue       TEXT,
  doi         TEXT,
  arxiv_id    TEXT,
  abstract    TEXT,
  md_path     TEXT,            -- data/papers/<slug>/paper.md
  pdf_path    TEXT,            -- data/papers/<slug>/paper.pdf
  sections    TEXT,            -- JSON: section boundaries/outline
  added_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES collections(id)
);

CREATE TABLE IF NOT EXISTS paper_collections (
  paper_slug    TEXT REFERENCES papers(slug) ON DELETE CASCADE,
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_slug, collection_id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_slug  TEXT REFERENCES papers(slug) ON DELETE CASCADE,
  backend     TEXT NOT NULL,   -- 'claude' | 'codex'
  title       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,   -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Phase-2 backlog tables (highlights, etc.) added when those cards land.
-- notes landed in migration 3, see SCHEMA_V3_NOTES below.
`

// [P2-01] Notes tab: one freeform note per paper, right-panel markdown editor.
//
// paper_slug is the PRIMARY KEY (not a separate autoincrement id +
// UNIQUE constraint) — this is a deliberate 1:1 modeling choice, not a
// simplification. The Notes tab has exactly one note per paper, so the
// natural key IS the uniqueness constraint, and it makes autosave a plain
// upsert-by-paper-slug (`INSERT ... ON CONFLICT(paper_slug) DO UPDATE`,
// same shape as `upsertPaper`) with no id indirection for callers to carry
// around. `ON DELETE CASCADE` removes a paper's note automatically when the
// paper itself is deleted — no orphaned rows, no separate cleanup step for
// the trash/purge flow.
export const SCHEMA_V3_NOTES = `
CREATE TABLE IF NOT EXISTS notes (
  paper_slug  TEXT PRIMARY KEY REFERENCES papers(slug) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);
`

// [P2-02] Highlight tool + Annotations tab: multiple highlights per paper, so
// (unlike notes) this table uses a synthetic caller-supplied `id` rather than
// `paper_slug` as the primary key. `anchor` is an opaque JSON string produced
// by the renderer's text-layer selection logic (offsets etc.) — this module
// stores it verbatim and never parses it, same "state vs. content" boundary
// as everywhere else in this file. `ON DELETE CASCADE` on the papers FK means
// purging a paper drops its highlights automatically (coordinate the on-disk
// side, if any, with the file layer — this table has none, highlights are
// pure DB state referencing paper.pdf pages).
export const SCHEMA_V4_HIGHLIGHTS = `
CREATE TABLE IF NOT EXISTS highlights (
  id          TEXT PRIMARY KEY,
  paper_slug  TEXT NOT NULL REFERENCES papers(slug) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  color       TEXT NOT NULL,
  quote       TEXT NOT NULL,
  anchor      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_highlights_paper ON highlights(paper_slug);
`

// [P2-04] ORCID author badges. Authors stay a plain `authors TEXT` JSON
// array (see SCHEMA_V1) — this migration does NOT touch that column. ORCIDs
// live in a new, additive, nullable parallel column: a JSON array of
// `(string | null)` entries, positionally aligned to `authors` (index i of
// `author_orcids` is the ORCID for `authors[i]`, or null if that author's
// ORCID is unknown). Existing rows get NULL (no backfill) — NULL means "no
// ORCID data known for this paper," distinct from an array of all-null
// entries ("we checked, none of these authors have an ORCID on file").
// Same purely-additive shape as the v2 `summary` column.
export const SCHEMA_V5_AUTHOR_ORCIDS = `
ALTER TABLE papers ADD COLUMN author_orcids TEXT;
`
