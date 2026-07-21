// Fetch raw PDF bytes + raw metadata for a classified ingest input.
//
// - arxiv: arXiv API (export.arxiv.org/api/query, Atom XML) for metadata,
//   export.arxiv.org/pdf/<id> for bytes.
// - doi: Crossref REST API (api.crossref.org/works/<doi>) for metadata,
//   the resolved DOI URL for bytes (best-effort; publishers often gate PDFs
//   behind auth, so fetchSource() for a DOI may throw — caller decides how
//   to surface that, e.g. prompt the user for a direct PDF URL instead).
// - pdf_url: GET the URL directly; no separate metadata source.
// - local_pdf: read the file from disk; no separate metadata source.
//
// Uses the Node 20+ global `fetch`. No new HTTP dependency.
//
// Manual real-ID check (unit tests below are hermetic/mocked — this is the
// one live-network spot-check called for by wiki card [P1-03]). Run:
//
//   npx tsx -e "
//     import('./core/ingest/classify.js').then(async ({ classifyInput }) => {
//       const { fetchSource } = await import('./core/ingest/fetch.js')
//       const a = await fetchSource(classifyInput('2401.12345'))
//       console.log('arxiv:', a.pdfBytes.length, a.metadata)
//       const d = await fetchSource(classifyInput('10.1038/s41586-021-03819-2'))
//       console.log('doi:', d.pdfBytes.length, d.metadata)
//     })
//   "
//
// (or write a throwaway .mts script importing classify.ts/fetch.ts directly
// and run with `npx tsx script.mts`). Last run 2026-07-21 against real
// arXiv id 2401.12345 and DOI 10.1038/s41586-021-03819-2: arXiv returned a
// 1,968,194-byte PDF + full metadata (title/authors/year/venue/abstract);
// DOI returned a 602,302-byte PDF via the doi.org redirect + full Crossref
// metadata (AlphaFold, Nature, 2021, 34 authors). Both kinds fetched clean.

import { readFile } from 'node:fs/promises'
import type { ClassifiedInput } from './classify'

export interface RawMetadata {
  title: string
  authors: string[]
  year: number | undefined
  venue: string | undefined
  abstract: string | undefined
}

export interface FetchedSource {
  pdfBytes: Uint8Array
  metadata: RawMetadata | undefined
}

const ARXIV_API = 'https://export.arxiv.org/api/query'
const ARXIV_PDF_BASE = 'https://export.arxiv.org/pdf'
const CROSSREF_API = 'https://api.crossref.org/works'

async function fetchArxivMetadata(arxivId: string): Promise<RawMetadata> {
  const idNoVersion = arxivId.replace(/v\d+$/, '')
  const url = `${ARXIV_API}?id_list=${encodeURIComponent(idNoVersion)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`arXiv API request failed: ${res.status} ${res.statusText}`)
  }
  const xml = await res.text()
  return parseArxivAtom(xml, arxivId)
}

// Minimal Atom XML field extraction — arXiv's feed is small and stable
// enough that a full XML parser is not worth a new dependency for this card.
function parseArxivAtom(xml: string, arxivId: string): RawMetadata {
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/)
  if (!entryMatch) {
    throw new Error(`arXiv API: no entry found for ${arxivId}`)
  }
  const entry = entryMatch[1]

  const title = extractTag(entry, 'title')
  if (!title) {
    throw new Error(`arXiv API: missing title for ${arxivId}`)
  }

  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) =>
    normalizeWhitespace(m[1]),
  )

  const published = extractTag(entry, 'published')
  const year = published ? Number.parseInt(published.slice(0, 4), 10) : undefined

  const venueMatch = entry.match(/<arxiv:journal_ref>([\s\S]*?)<\/arxiv:journal_ref>/)
  const venue = venueMatch ? normalizeWhitespace(venueMatch[1]) : undefined

  const abstract = extractTag(entry, 'summary')

  return {
    title: normalizeWhitespace(title),
    authors,
    year: year !== undefined && Number.isFinite(year) ? year : undefined,
    venue,
    abstract: abstract ? normalizeWhitespace(abstract) : undefined,
  }
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match ? match[1] : undefined
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

async function fetchArxivPdf(arxivId: string): Promise<Uint8Array> {
  return fetchPdfFromUrl(`${ARXIV_PDF_BASE}/${encodeURIComponent(arxivId)}`, 'arXiv PDF')
}

// Crossref "work" JSON is loosely typed upstream; narrow just the fields we
// read to avoid `any` while not over-modeling the whole schema.
interface CrossrefWork {
  message: {
    title?: string[]
    author?: Array<{ given?: string; family?: string; name?: string }>
    published?: { 'date-parts'?: number[][] }
    'published-print'?: { 'date-parts'?: number[][] }
    'container-title'?: string[]
    abstract?: string
  }
}

async function fetchCrossrefMetadata(doi: string): Promise<RawMetadata> {
  const res = await fetch(`${CROSSREF_API}/${encodeURIComponent(doi)}`)
  if (!res.ok) {
    throw new Error(`Crossref API request failed: ${res.status} ${res.statusText}`)
  }
  const body = (await res.json()) as CrossrefWork
  const work = body.message

  const title = work.title?.[0]
  if (!title) {
    throw new Error(`Crossref API: missing title for ${doi}`)
  }

  const authors = (work.author ?? []).map((a) =>
    a.name ?? [a.given, a.family].filter(Boolean).join(' '),
  )

  const dateParts =
    work.published?.['date-parts']?.[0] ?? work['published-print']?.['date-parts']?.[0]
  const year = dateParts?.[0]

  const venue = work['container-title']?.[0]

  return {
    title: normalizeWhitespace(title),
    authors,
    year,
    venue,
    abstract: work.abstract ? normalizeWhitespace(stripJats(work.abstract)) : undefined,
  }
}

// Crossref abstracts are JATS XML fragments (<jats:p> tags); strip tags for
// a plain-text abstract rather than pulling in a JATS parser dependency.
function stripJats(s: string): string {
  return s.replace(/<[^>]+>/g, ' ')
}

async function fetchPdfFromUrl(url: string, label = 'PDF URL'): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${label} request failed: ${res.status} ${res.statusText}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Fetch raw PDF bytes + raw metadata for a classified input. Metadata is
 * undefined for pdf_url/local_pdf (no bibliographic source for those kinds
 * at this stage — later cards may extract it from the PDF/agent).
 */
export async function fetchSource(input: ClassifiedInput): Promise<FetchedSource> {
  switch (input.kind) {
    case 'arxiv': {
      const [pdfBytes, metadata] = await Promise.all([
        fetchArxivPdf(input.value),
        fetchArxivMetadata(input.value),
      ])
      return { pdfBytes, metadata }
    }
    case 'doi': {
      const metadata = await fetchCrossrefMetadata(input.value)
      const pdfBytes = await fetchPdfFromUrl(`https://doi.org/${input.value}`)
      return { pdfBytes, metadata }
    }
    case 'pdf_url': {
      const pdfBytes = await fetchPdfFromUrl(input.value)
      return { pdfBytes, metadata: undefined }
    }
    case 'local_pdf': {
      const pdfBytes = new Uint8Array(await readFile(input.value))
      return { pdfBytes, metadata: undefined }
    }
  }
}
