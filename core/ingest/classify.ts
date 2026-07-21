// Classify a raw ingest input string into one of four kinds and derive a
// stable, filesystem-safe slug for it. Synchronous, no network I/O —
// fetch.ts does the network work based on this classification. The one
// exception is a local filesystem existence check for local_pdf inputs
// (classify is the validation boundary for "does this path make sense",
// fetch.ts trusts the result and just reads the bytes).

import { existsSync } from 'node:fs'

export type InputKind = 'arxiv' | 'doi' | 'pdf_url' | 'local_pdf'

export interface ClassifiedInput {
  kind: InputKind
  /** Stable, filesystem-safe identifier for data/papers/<slug>/. */
  slug: string
  /** Normalized form of the identifier (arXiv id, DOI, URL, or path). */
  value: string
}

// Matches bare arXiv ids (old and new style) and arxiv.org URLs.
// New style: 4 digits . 4-5 digits, optional version suffix (vN).
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})(v\d+)?$/
const ARXIV_URL_RE =
  /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(?<id>\d{4}\.\d{4,5})(?<version>v\d+)?(?:\.pdf)?\/?$/i

// DOI: "10.<registrant>/<suffix>" per the DOI handbook, bare or as a URL.
const DOI_BARE_RE = /^10\.\d{4,9}\/\S+$/
const DOI_URL_RE = /^https?:\/\/(dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i

/**
 * Filesystem-safe slug: lowercase, [a-z0-9._-] only, no path separators.
 * DOIs commonly contain "/" and other punctuation Crossref allows, so this
 * is a lossy-but-stable transform (not reversible) rather than a raw copy.
 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function classifyInput(raw: string): ClassifiedInput {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new Error('classifyInput: empty input')
  }

  const arxivUrlMatch = trimmed.match(ARXIV_URL_RE)
  if (arxivUrlMatch?.groups) {
    const id = arxivUrlMatch.groups.id + (arxivUrlMatch.groups.version ?? '')
    return { kind: 'arxiv', slug: `arxiv-${id}`, value: id }
  }
  if (ARXIV_ID_RE.test(trimmed)) {
    return { kind: 'arxiv', slug: `arxiv-${trimmed}`, value: trimmed }
  }

  const doiUrlMatch = trimmed.match(DOI_URL_RE)
  if (doiUrlMatch) {
    const doi = decodeURIComponent(doiUrlMatch[2])
    return { kind: 'doi', slug: `doi-${slugify(doi)}`, value: doi }
  }
  if (DOI_BARE_RE.test(trimmed)) {
    return { kind: 'doi', slug: `doi-${slugify(trimmed)}`, value: trimmed }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed)
    if (/\.pdf$/i.test(parsed.pathname)) {
      const base = parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.pathname
      const name = base.replace(/\.pdf$/i, '')
      return { kind: 'pdf_url', slug: `pdf-${slugify(name)}`, value: trimmed }
    }
    throw new Error(`classifyInput: unrecognized URL (not arXiv, DOI, or .pdf): ${trimmed}`)
  }

  // Local filesystem path — accept absolute or relative paths ending .pdf.
  // Existence is checked here (classify is the validation boundary); fetch.ts
  // trusts a 'local_pdf' result and reads the file directly.
  //
  // Known limitation: local_pdf and pdf_url slugs are derived from the
  // basename only, so e.g. /a/paper.pdf and /b/paper.pdf collide to the same
  // slug. Acceptable for this card (single-source ingest); a later card can
  // disambiguate (e.g. short content hash suffix) if collisions are hit.
  if (/\.pdf$/i.test(trimmed)) {
    if (!existsSync(trimmed)) {
      throw new Error(`classifyInput: local PDF not found: ${trimmed}`)
    }
    const base = trimmed.split('/').filter(Boolean).pop() ?? trimmed
    const name = base.replace(/\.pdf$/i, '')
    return { kind: 'local_pdf', slug: `local-${slugify(name)}`, value: trimmed }
  }

  throw new Error(`classifyInput: unrecognized input: ${trimmed}`)
}
