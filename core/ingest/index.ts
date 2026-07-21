// Ingestion pipeline orchestrator (pure Node/TS — no Python) — [P1-06].
//
// Composes the four already-landed ingest steps into one persisted result:
//   1. classify — classify.ts  (raw input string -> kind + stable slug)
//   2. fetch    — fetch.ts     (network -> PDF bytes + raw bibliographic metadata)
//   3. convert  — convert.ts   (PDF bytes -> paper.md markdown, text-layer only)
//   4. extract  — extract.ts   (one ACP agent turn over paper.md -> sections +
//                                agent-refined metadata; never throws, degrades)
//   5. store    — write data/papers/<slug>/{paper.pdf,paper.md} to disk, then
//                 upsert the SQLite row via core/library/repo.ts
//
// Dependencies (ACP client, DB handle, data dir) are injected so tests run
// hermetically: no real adapter spawned, no real network call, no real app.db
// (see index.test.ts — fake AcpClient + stubbed global fetch + a temp-file
// SQLite DB via core/store/db.ts's openDb({ path })).
//
// Idempotency: classifyInput() is a pure function of the input string, so
// re-ingesting the same input always resolves to the same slug. Files are
// written with writeFile (overwrite in place, never appended/renamed), and
// the DB row is upserted (core/library/repo.ts's upsertPaper, `ON CONFLICT
// slug DO UPDATE`) — a second ingest() call for the same input can never
// produce a duplicate row or a duplicate/corrupt file.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Database } from 'better-sqlite3'

import type { AcpBackend, AcpClient } from '../acp/client.js'
import type { PaperRecord } from '../library/repo.js'
import { upsertPaper } from '../library/repo.js'
import { classifyInput } from './classify.js'
import type { ClassifiedInput, InputKind } from './classify.js'
import { convertPdfToMarkdown } from './convert.js'
import { extractPaper } from './extract.js'
import { fetchSource } from './fetch.js'

export type { InputKind }

export interface IngestPaths {
  pdfPath: string
  mdPath: string
}

export interface IngestMetadata {
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
}

export interface IngestResult {
  slug: string
  title: string
  metadata: IngestMetadata
  paths: IngestPaths
}

export interface IngestOptions {
  /** Open SQLite handle (core/store/db.ts's openDb()) — required; the
   * orchestrator persists through it but never opens/closes it itself, so
   * callers (electron/main.ts, tests) control the DB's lifecycle. */
  db: Database
  /** Base dir papers are written under, as `<dataDir>/papers/<slug>/`.
   * Defaults to 'data', matching core/store/db.ts's DEFAULT_DB_PATH and
   * electron/main.ts's read-paper-file handler (both relative to cwd) so a
   * freshly-ingested paper is immediately readable by the reader. */
  dataDir?: string
  /** Injectable ACP client for the extract step. Defaults to StdioAcpClient
   * (spawns a real adapter) inside extractPaper() — tests must pass a fake. */
  client?: AcpClient
  backend?: AcpBackend
}

const DEFAULT_DATA_DIR = 'data'

export { classifyInput }

/**
 * Ingest a paper end-to-end: classify -> fetch -> convert -> extract -> write
 * files + DB row. See module comment for the idempotency guarantee.
 */
export async function ingest(raw: string, options: IngestOptions): Promise<IngestResult> {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR

  const classified: ClassifiedInput = classifyInput(raw)
  const fetched = await fetchSource(classified)
  // convertPdfToMarkdown's PDF.js backend (unpdf) detaches/transfers the
  // ArrayBuffer it's given while parsing — pass it a copy so
  // fetched.pdfBytes stays intact for the paper.pdf write below.
  const markdown = await convertPdfToMarkdown(fetched.pdfBytes.slice())

  const paperDir = join(dataDir, 'papers', classified.slug)
  await mkdir(paperDir, { recursive: true })
  const pdfPath = join(paperDir, 'paper.pdf')
  const mdPath = join(paperDir, 'paper.md')
  // Overwrite in place (not append/rename) — re-ingest of the same slug
  // replaces prior file contents rather than accumulating duplicates.
  await Promise.all([writeFile(pdfPath, fetched.pdfBytes), writeFile(mdPath, markdown)])

  const extracted = await extractPaper(mdPath, { client: options.client, backend: options.backend })

  // Prefer the agent's paper.md-derived metadata (extract.ts); fall back to
  // the raw fetch-time metadata (arXiv/Crossref) for whatever the agent
  // didn't find, and finally to the classified input value so `title` is
  // never empty even in a fully degraded extraction.
  const metadata: IngestMetadata = {
    title: extracted.metadata.title ?? fetched.metadata?.title ?? classified.value,
    authors: extracted.metadata.authors ?? fetched.metadata?.authors ?? [],
    year: extracted.metadata.year ?? fetched.metadata?.year,
    venue: extracted.metadata.venue ?? fetched.metadata?.venue,
    abstract: extracted.metadata.abstract ?? fetched.metadata?.abstract,
  }

  const record: PaperRecord = {
    slug: classified.slug,
    title: metadata.title,
    authors: metadata.authors,
    year: metadata.year,
    venue: metadata.venue,
    doi: classified.kind === 'doi' ? classified.value : undefined,
    arxivId: classified.kind === 'arxiv' ? classified.value : undefined,
    abstract: metadata.abstract,
    mdPath,
    pdfPath,
    sections: extracted.sections,
    addedAt: new Date().toISOString(),
  }
  upsertPaper(options.db, record)

  return {
    slug: classified.slug,
    title: metadata.title,
    metadata,
    paths: { pdfPath, mdPath },
  }
}
