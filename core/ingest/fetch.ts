// Fetch raw PDF bytes and raw bibliographic metadata for a classified input.
//
// Network boundary:
//   - arXiv: metadata from the Atom API, PDF bytes from export.arxiv.org/pdf.
//   - DOI: metadata from api.crossref.org/works, PDF bytes from doi.org.
//   - pdf_url: PDF bytes straight from the URL, metadata empty.
//   - local_pdf: PDF bytes straight off disk, metadata empty.
//
// Why this file exists as a separate phase from extract.ts:
//   1. arXiv and Crossref are authoritative bibliographic sources. For
//      papers with an arXiv id or DOI, we don't need to ask an agent to
//      guess the title, author list, or year — we have the publisher record.
//   2. An agent run (extract.ts) costs latency and tokens; fetch.ts is cheap
//      HTTP GETs.
//   3. For DOIs whose publisher PDF is open-access, fetching straight from
//      doi.org gets the real paper. For closed DOIs, the publisher redirects
//      behind auth, so fetchSource() for a DOI may throw — caller decides how
//      to degrade (e.g. prompt the user for a local PDF or drop to metadata-
//      only).
//
// How to test manually without launching the UI:
//   node -e "
//     (async () => {
//       const { classifyInput } = await import('./core/ingest/classify.js')
//       const { fetchSource } = await import('./core/ingest/fetch.js')
//       const a = await fetchSource(classifyInput('2401.12345'))
//       console.log('arXiv:', a.metadata?.title, a.pdfBytes.byteLength)
//       const d = await fetchSource(classifyInput('10.1038/s41586-021-03819-2'))
//       console.log('DOI:', d.metadata?.title, d.pdfBytes.byteLength)
//     })()
//   "
// (The DOI above is open-access and has rich, multi-author, multi-affiliation
// metadata (AlphaFold, Nature, 2021, 34 authors). Both kinds fetched clean.

import { readFile } from 'node:fs/promises'
import type { ClassifiedInput } from './classify'
import { assertSafeUrl, type DnsLookupFn } from './ssrf'

export interface RawMetadata {
  title: string
  authors: string[]
  year: number | undefined
  venue: string | undefined
  abstract: string | undefined
  /** Bare ORCID ids (e.g. "0000-0002-1825-0097"), positionally aligned to
   * `authors`; null for authors with no known ORCID. Crossref-only signal —
   * undefined when the source (e.g. arXiv) never carries ORCIDs. */
  authorOrcids?: (string | null)[]
}

export interface FetchedSource {
  pdfBytes: Uint8Array
  metadata: RawMetadata | undefined
}

export interface FetchPdfOptions {
  /** Maximum time in milliseconds before aborting the request. Defaults to 30,000ms. */
  timeoutMs?: number
  /** Maximum bytes allowed for the PDF. Defaults to 52,428,800 (50 MB). */
  maxBytes?: number
  /** Custom DNS lookup function (primarily for hermetic testing). */
  lookup?: DnsLookupFn
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch
  /** Maximum redirect hops allowed before aborting. Defaults to 5. */
  maxRedirects?: number
}

export const DEFAULT_PDF_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_PDF_BYTES = 50 * 1024 * 1024 // 50 MB
export const DEFAULT_MAX_REDIRECTS = 5

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

async function fetchArxivPdf(arxivId: string, options?: FetchPdfOptions): Promise<Uint8Array> {
  return fetchPdfFromUrl(`${ARXIV_PDF_BASE}/${encodeURIComponent(arxivId)}`, 'arXiv PDF', options)
}

// Crossref "work" JSON is loosely typed upstream; narrow just the fields we
// read to avoid `any` while not over-modeling the whole schema.
interface CrossrefWork {
  message: {
    title?: string[]
    author?: Array<{ given?: string; family?: string; name?: string; ORCID?: unknown }>
    published?: { 'date-parts'?: number[][] }
    'published-print'?: { 'date-parts'?: number[][] }
    'container-title'?: string[]
    abstract?: string
  }
}

// Crossref's ORCID field is a URL like "http://orcid.org/0000-0002-1825-0097"
// or "https://orcid.org/0000-0002-1825-0097/" — normalize to the bare id.
// Defensive: any non-string or unrecognized shape yields null rather than
// throwing (ORCID is a best-effort signal, never load-bearing for ingest).
function normalizeOrcid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const stripped = value.trim().replace(/^https?:\/\/orcid\.org\//i, '').replace(/\/+$/, '')
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(stripped) ? stripped : null
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

  const crossrefAuthors = work.author ?? []
  const authors = crossrefAuthors.map((a) =>
    a.name ?? [a.given, a.family].filter(Boolean).join(' '),
  )
  const authorOrcids = crossrefAuthors.map((a) => normalizeOrcid(a.ORCID))
  const hasAnyOrcid = authorOrcids.some((id) => id !== null)

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
    authorOrcids: hasAnyOrcid ? authorOrcids : undefined,
  }
}

// Crossref abstracts are JATS XML fragments (<jats:p> tags); strip tags for
// a plain-text abstract rather than pulling in a JATS parser dependency.
function stripJats(s: string): string {
  return s.replace(/<[^>]+>/g, ' ')
}

export async function fetchPdfFromUrl(
  url: string,
  label = 'PDF URL',
  options?: FetchPdfOptions,
): Promise<Uint8Array> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_PDF_BYTES
  const maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const fetchImpl = options?.fetch ?? globalThis.fetch
  const lookupFn = options?.lookup

  const signal = AbortSignal.timeout(timeoutMs)
  let currentUrl = url
  let redirects = 0

  while (true) {
    await assertSafeUrl(currentUrl, lookupFn)

    let res: Response
    try {
      res = await fetchImpl(currentUrl, {
        signal,
        redirect: 'manual',
      })
    } catch (err: unknown) {
      if (signal.aborted) {
        throw new Error(`${label} request timed out after ${timeoutMs}ms`)
      }
      throw err
    }

    // Handle redirects manually to validate destination address against SSRF
    if (res.status >= 300 && res.status < 400) {
      redirects++
      if (redirects > maxRedirects) {
        await res.body?.cancel().catch(() => {})
        throw new Error(`${label} exceeded maximum redirect limit of ${maxRedirects}`)
      }
      const location = res.headers.get('location')
      if (!location) {
        await res.body?.cancel().catch(() => {})
        throw new Error(`${label} redirect missing Location header (status ${res.status})`)
      }
      await res.body?.cancel().catch(() => {})
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`${label} request failed: ${res.status} ${res.statusText}`)
    }

    // Check Content-Length header early if available
    const contentLengthHeader = res.headers.get('content-length')
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10)
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await res.body?.cancel().catch(() => {})
        throw new Error(
          `${label} exceeds maximum allowed size of ${maxBytes} bytes (reported ${contentLength})`,
        )
      }
    }

    // Stream response body and enforce maximum size cap
    if (!res.body) {
      return new Uint8Array(0)
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    try {
      while (true) {
        if (signal.aborted) {
          throw new Error(`${label} request timed out after ${timeoutMs}ms`)
        }
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          totalBytes += value.byteLength
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => {})
            throw new Error(`${label} exceeds maximum allowed size of ${maxBytes} bytes`)
          }
          chunks.push(value)
        }
      }
    } catch (err: unknown) {
      await reader.cancel().catch(() => {})
      if (signal.aborted) {
        throw new Error(`${label} request timed out after ${timeoutMs}ms`)
      }
      throw err
    }

    const result = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }
}

/**
 * Fetch raw PDF bytes + raw metadata for a classified input. Metadata is
 * undefined for pdf_url/local_pdf (no bibliographic source for those kinds
 * at this stage — later cards may extract it from the PDF/agent).
 */
export async function fetchSource(
  input: ClassifiedInput,
  options?: FetchPdfOptions,
): Promise<FetchedSource> {
  switch (input.kind) {
    case 'arxiv': {
      const [pdfBytes, metadata] = await Promise.all([
        fetchArxivPdf(input.value, options),
        fetchArxivMetadata(input.value),
      ])
      return { pdfBytes, metadata }
    }
    case 'doi': {
      const metadata = await fetchCrossrefMetadata(input.value)
      const pdfBytes = await fetchPdfFromUrl(`https://doi.org/${input.value}`, 'DOI PDF', options)
      return { pdfBytes, metadata }
    }
    case 'pdf_url': {
      const pdfBytes = await fetchPdfFromUrl(input.value, 'PDF URL', options)
      return { pdfBytes, metadata: undefined }
    }
    case 'local_pdf': {
      const pdfBytes = new Uint8Array(await readFile(input.value))
      return { pdfBytes, metadata: undefined }
    }
  }
}
