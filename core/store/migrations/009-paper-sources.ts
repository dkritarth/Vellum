// Additive provenance for PDF sources. Existing papers remain unbound until
// ingest can establish identity safely; never infer it from a basename alone.
export const SOURCE_IDENTITY_SQL = `
CREATE TABLE paper_sources (
  source_id   TEXT PRIMARY KEY,
  paper_slug  TEXT NOT NULL UNIQUE REFERENCES papers(slug) ON DELETE CASCADE
);
`
