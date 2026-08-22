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
