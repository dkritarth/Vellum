// Classify a raw ingest input string into one of four kinds and derive a
// stable, filesystem-safe slug for it. Synchronous, no network I/O —
// fetch.ts does the network work based on this classification. The one
// exception is a local filesystem existence check for local_pdf inputs
// (classify is the validation boundary for "does this path make sense",
// fetch.ts trusts the result and just reads the bytes).

import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type InputKind = 'arxiv' | 'doi' | 'pdf_url' | 'local_pdf'

export interface ClassifiedInput {
  kind: InputKind
  /** Stable, filesystem-safe identifier for data/papers/<slug>/. */
  slug: string
  /** Pre-source-identity slug, used only to reconcile existing papers safely. */
  legacySlug?: string
  /** Normalized form of the identifier (arXiv id, DOI, URL, or path). */
  value: string
}

// Matches modern arXiv ids and arxiv.org URLs.
// New style: 4 digits . 4-5 digits, optional version suffix (vN).
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})(v\d+)?$/
const ARXIV_URL_RE =
  /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(?<id>\d{4}\.\d{4,5})(?<version>v\d+)?(?:\.pdf)?\/?$/i

// Legacy archive[.subject]/YYMMNNN identifiers. Subject class is redundant
// identity and must be removed for arXiv API metadata lookup.
const LEGACY_ARXIV_RE =
  /^(?<archive>[a-z]+(?:-[a-z]+)*)(?:\.[a-z]{2})?\/(?<number>\d{2}(?:0[1-9]|1[0-2])(?!000)\d{3})(?<version>v[1-9]\d*)?(?:\.pdf)?$/i
const LEGACY_ARXIV_URL_RE = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)\/?$/i

// DOI: "10.<registrant>/<suffix>" per the DOI handbook, bare or as a URL.
const DOI_BARE_RE = /^10\.\d{4,9}\/\S+$/
const DOI_URL_RE = /^https?:\/\/(dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i
// arXiv registers DOIs with DataCite (printed on arXiv PDFs since 2022);
// Crossref has no record of them, so they route to the arXiv path.
const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(.+)$/i
const IDENTITY_HOST_RE = /^(?:www\.)?arxiv\.org$|^(?:dx\.)?doi\.org$/i

/** Query strings and fragments never identify an arXiv paper or a DOI
 * (`?context=cs.LG`, `#abstract`, `?utm_source=…`); drop them for those
 * hosts. Generic PDF URLs keep their query (it can select the file). */
function withoutQueryOnIdentityHosts(input: string): string {
  if (!/^https?:\/\//i.test(input)) return input
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return input
  }
  if (!IDENTITY_HOST_RE.test(url.hostname) || (!url.search && !url.hash)) return input
  return `${url.protocol}//${url.host}${url.pathname}`
}

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

// Identity uses the DOI name or PDF location, never PDF content. Changing
// bytes remains a re-ingest. PDF URLs retain queries and omit fragments.
// Keep the full digest and cap the display prefix for safe paths.
function sourceInput(kind: 'doi' | 'pdf_url' | 'local_pdf', name: string, value: string): ClassifiedInput {
  const legacySlug = `${kind === 'pdf_url' ? 'pdf' : kind === 'doi' ? 'doi' : 'local'}-${slugify(name)}`
  const digest = createHash('sha256').update(kind + ':' + value).digest('hex')
  return { kind, value, slug: `${legacySlug.slice(0, 80)}-${digest}`, legacySlug }
}

export function classifyInput(raw: string): ClassifiedInput {
  let trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new Error('classifyInput: empty input')
  }
  if (/^file:/i.test(trimmed)) {
    try {
      trimmed = fileURLToPath(trimmed)
    } catch {
      throw new Error(`classifyInput: malformed file URL: ${trimmed}`)
    }
  }
  trimmed = withoutQueryOnIdentityHosts(trimmed)

  const arxivUrlMatch = trimmed.match(ARXIV_URL_RE)
  if (arxivUrlMatch?.groups) {
    const id = arxivUrlMatch.groups.id + (arxivUrlMatch.groups.version ?? '')
    return { kind: 'arxiv', slug: `arxiv-${id}`, value: id }
  }
  if (ARXIV_ID_RE.test(trimmed)) {
    return { kind: 'arxiv', slug: `arxiv-${trimmed}`, value: trimmed }
  }

  const legacyId = trimmed.match(LEGACY_ARXIV_URL_RE)?.[1] ?? trimmed
  const legacyMatch = legacyId.match(LEGACY_ARXIV_RE)
  if (legacyMatch?.groups) {
    const { archive, number, version = '' } = legacyMatch.groups
    const id = `${archive.toLowerCase()}/${number}${version.toLowerCase()}`
    return { kind: 'arxiv', slug: `arxiv-${id.replace('/', '-')}`, value: id }
  }

  const doiUrlMatch = trimmed.match(DOI_URL_RE)
  let doiName = trimmed
  if (doiUrlMatch) {
    try {
      doiName = decodeURIComponent(doiUrlMatch[2])
    } catch {
      throw new Error(`classifyInput: malformed DOI URL: ${trimmed}`)
    }
  }
  const arxivDoi = doiName.match(ARXIV_DOI_RE)
  if (arxivDoi) {
    // Only an arXiv identifier may follow the prefix. Classifying an arbitrary
    // remainder would let a DOI string become a local path or a download URL.
    const id = arxivDoi[1]
    if (!ARXIV_ID_RE.test(id) && !LEGACY_ARXIV_RE.test(id)) {
      throw new Error(`classifyInput: unrecognized arXiv DOI: ${trimmed}`)
    }
    return classifyInput(id)
  }
  if (DOI_BARE_RE.test(doiName)) {
    // DOI case folding applies to ASCII letters; URL escaping is transport-only.
    // https://www.crossref.org/documentation/member-setup/constructing-your-dois/
    const doi = doiName.replace(/[A-Z]/g, char => char.toLowerCase())
    return sourceInput('doi', doi, doi)
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed)
    if (/\.pdf$/i.test(parsed.pathname)) {
      const base = parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.pathname
      const name = base.replace(/\.pdf$/i, '')
      parsed.hash = ''
      return sourceInput('pdf_url', name, parsed.href)
    }
    throw new Error(`classifyInput: unrecognized URL (not arXiv, DOI, or .pdf): ${trimmed}`)
  }

  // Local filesystem path — accept absolute or relative paths ending .pdf.
  // Existence is checked here (classify is the validation boundary); fetch.ts
  // trusts a 'local_pdf' result and reads the file directly.
  if (/\.pdf$/i.test(trimmed)) {
    if (!existsSync(trimmed)) {
      throw new Error(`classifyInput: local PDF not found: ${trimmed}`)
    }
    const path = resolve(trimmed)
    const base = basename(path)
    const name = base.replace(/\.pdf$/i, '')
    return sourceInput('local_pdf', name, path)
  }

  throw new Error(`classifyInput: unrecognized input: ${trimmed}`)
}
