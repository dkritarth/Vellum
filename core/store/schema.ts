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

-- Phase-2 backlog tables (notes, highlights) added when those cards land.
`
