// Ingestion pipeline orchestrator (pure Node/TS — no Python) — [P1-06].
//
// Composes the four already-landed ingest steps into one persisted result:
//   1. classify — classify.ts  (raw input string -> kind + stable slug)
//   2. fetch    — fetch.ts     (network -> PDF bytes + raw bibliographic metadata)
//   3. convert  — convert.ts   (PDF bytes -> paper.md markdown, text-layer only)
//   4. extract  — extract.ts   (one ACP agent turn over paper.md -> sections +
//                                agent-refined metadata; never throws, degrades)
//   5. store    — publish staged files with recoverable backups around the
//                 final SQLite metadata/source transaction.
//
// Dependencies (ACP client, DB handle, data dir) are injected so tests run
// hermetically: no real adapter spawned, no real network call, no real app.db
// (see index.test.ts — fake AcpClient + stubbed global fetch + a temp-file
// SQLite DB via core/store/db.ts's openDb({ path })).
//
// Idempotency: source hashes distinguish PDF locations and DOI names. Legacy
// reconciliation uses PDF bytes or stored DOI names without renaming research keys.
// Re-ingest updates files and metadata through the same paper slug.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Database } from 'better-sqlite3'

import type { AcpBackend, AcpClient } from '../acp/client.js'
import type { PaperRecord } from '../library/repo.js'
import { getPaper, upsertPaper } from '../library/repo.js'
import { classifyInput } from './classify.js'
import type { ClassifiedInput, InputKind } from './classify.js'
import { convertPdfToMarkdown, guessPdfTitle } from './convert.js'
import { extractPaper } from './extract.js'
import { fetchSource } from './fetch.js'
import { recordPaperSource, resolvePaperSource } from './source-identity.js'
import { withPaperPublication } from './publication.js'
import { summarizePaper } from './summary.js'

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
  /** Bare ORCID ids positionally aligned to `authors`; fetch-only signal
   * (Crossref), never agent-extracted. Undefined when the source has none. */
  authorOrcids?: (string | null)[]
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
   * callers (electron/main.ts, tests) control the DB's lifecycle. Must not
   * already be inside a caller-owned transaction. */
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

// DOI metadata establishes identity even when publisher PDF bytes change.
// Reuse #96's binding transaction, but never its byte-only legacy fallback:
// distinct DOIs can legitimately serve identical PDFs.
function resolveIngestSource(
  input: ClassifiedInput,
  pdfBytes: Uint8Array,
  options: { db: Database; dataDir: string },
): IngestPaths & { slug: string } {
  if (input.kind !== 'doi') return resolvePaperSource(input, pdfBytes, options)
  return options.db.transaction(() => {
    // Keep binding lookup enabled; limit fallback to the new hash slug itself.
    const withoutLegacyFallback = { ...input, legacySlug: input.slug }
    const current = resolvePaperSource(withoutLegacyFallback, pdfBytes, options)
    if (getPaper(options.db, current.slug)) return current
    const legacy = input.legacySlug && getPaper(options.db, input.legacySlug)
    if (!legacy || !legacy.doi || !legacy.pdfPath || !legacy.mdPath) return current
    let sameDoi = false
    try {
      const stored = classifyInput(legacy.doi)
      sameDoi = stored.kind === 'doi' && stored.value === input.value
    } catch {
      // Unrecognized legacy provenance cannot authorize overwriting research.
    }
    if (!sameDoi) return current
    const claimed = options.db.prepare('SELECT source_id FROM paper_sources WHERE paper_slug = ?')
      .get(legacy.slug)
    if (claimed) return current
    recordPaperSource(options.db, input, legacy.slug)
    return resolvePaperSource(withoutLegacyFallback, pdfBytes, options)
  }).immediate()
}

/**
 * Ingest a paper end-to-end: classify -> fetch -> convert -> extract -> write
 * files + DB row. See module comment for the idempotency guarantee.
 */
export async function ingest(raw: string, options: IngestOptions): Promise<IngestResult> {
  // A caller-owned transaction could roll back after files were committed.
  if (options.db.inTransaction) throw new Error('ingest: requires ownership of the final database transaction')
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR

  const classified: ClassifiedInput = classifyInput(raw)
  const fetched = await fetchSource(classified)
  // convertPdfToMarkdown's PDF.js backend (unpdf) detaches/transfers the
  // ArrayBuffer it's given while parsing — pass it a copy so
  // fetched.pdfBytes stays intact for the paper.pdf write below.
  const markdown = await convertPdfToMarkdown(fetched.pdfBytes.slice())

  const stagingRoot = join(dataDir, 'papers')
  await mkdir(stagingRoot, { recursive: true })
  const staging = await mkdtemp(join(stagingRoot, '.ingest-'))
  const candidate = { pdfPath: join(staging, 'paper.pdf'), mdPath: join(staging, 'paper.md') }
  try {
    // Sequential writes settle before cleanup even if one fails.
    await writeFile(candidate.pdfPath, fetched.pdfBytes)
    await writeFile(candidate.mdPath, markdown)
    const extracted = await extractPaper(candidate.mdPath, { client: options.client, backend: options.backend })
    const summary = await summarizePaper(candidate.mdPath, { client: options.client, backend: options.backend })

    // Prefer the agent's paper.md-derived metadata (extract.ts); fall back to
    // the raw fetch-time metadata (arXiv/Crossref) for whatever the agent
    // didn't find.
    const finalAuthors = extracted.metadata.authors ?? fetched.metadata?.authors ?? []

    // ORCIDs are a fetch-only signal (Crossref), positionally aligned to
    // fetched.metadata.authors — NOT to whatever the agent-extracted authors
    // array ends up being. If the agent's author list wins and diverges from
    // Crossref's (reorder, different formatting, truncation, extra/missing
    // author), keeping the Crossref-aligned ORCIDs would attach badges to the
    // wrong author. Only trust authorOrcids when the persisted authors array
    // is content-equal (same length + order + strings) to the Crossref list
    // it was aligned to; otherwise drop it (undefined -> DB column NULL). No
    // fuzzy re-matching — conservative "aligned or nothing".
    const fetchedAuthors = fetched.metadata?.authors
    const authorsMatchFetched =
      fetchedAuthors !== undefined &&
      finalAuthors.length === fetchedAuthors.length &&
      finalAuthors.every((a, i) => a === fetchedAuthors[i])
    const authorOrcids = authorsMatchFetched ? fetched.metadata?.authorOrcids : undefined

    // Blank strings count as missing: an agent answering `"title": ""` must
    // not produce an untitled paper. Without agent or fetch metadata, guess the
    // title from the PDF's first page, then fall back to the file name so the
    // title is never empty and never a raw filesystem path.
    const title =
      nonBlank(extracted.metadata.title) ??
      nonBlank(fetched.metadata?.title) ??
      (await guessPdfTitle(fetched.pdfBytes.slice())) ??
      fallbackTitle(classified)

    const metadata: IngestMetadata = {
      title,
      authors: finalAuthors,
      year: extracted.metadata.year ?? fetched.metadata?.year,
      venue: extracted.metadata.venue ?? fetched.metadata?.venue,
      abstract: extracted.metadata.abstract ?? fetched.metadata?.abstract,
      authorOrcids,
    }

    // Resolve only at final commit: two asynchronously staged sources may
    // both match an unclaimed legacy paper. Adoption/binding rolls back with files.
    const { slug, pdfPath, mdPath } = withPaperPublication(candidate, (publish) => options.db.transaction(() => {
      const paths = resolveIngestSource(classified, fetched.pdfBytes, { db: options.db, dataDir })
      const { slug, pdfPath, mdPath } = paths
      const record: PaperRecord = {
        slug,
        title: metadata.title,
        authors: metadata.authors,
        year: metadata.year,
        venue: metadata.venue,
        doi: classified.kind === 'doi' ? classified.value : undefined,
        arxivId: classified.kind === 'arxiv' ? classified.value : undefined,
        abstract: metadata.abstract,
        summary,
        mdPath,
        pdfPath,
        sections: extracted.sections,
        addedAt: new Date().toISOString(),
        authorOrcids: metadata.authorOrcids,
      }
      publish(paths)
      upsertPaper(options.db, record)
      recordPaperSource(options.db, classified, slug)
      return paths
    }).immediate())

    return {
      slug,
      title: metadata.title,
      metadata,
      paths: { pdfPath, mdPath },
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(error => {
      console.warn(`ingest: candidate files retained at ${staging}`, error)
    })
  }
}

/** Last-resort display title: a file name without its directory or `.pdf`
 * extension for local/URL PDFs, the identifier itself for arXiv/DOI. */
export function fallbackTitle(classified: ClassifiedInput): string {
  if (classified.kind !== 'local_pdf' && classified.kind !== 'pdf_url') return classified.value
  // Only URLs carry query strings/fragments; '?' and '#' are legal in file names.
  const location = classified.kind === 'pdf_url' ? (classified.value.split(/[?#]/)[0] ?? classified.value) : classified.value
  const name = location.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const stem = name.replace(/\.pdf$/i, '')
  if (classified.kind === 'local_pdf') return stem || classified.value
  try {
    return decodeURIComponent(stem) || classified.value
  } catch {
    return stem || classified.value
  }
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
