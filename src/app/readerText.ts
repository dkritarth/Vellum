// Text-layer helpers shared by Reader and ReaderPage: highlight anchors
// (character offsets over a page's text layer) and [P2-03] inline citation
// detection/injection. All DOM-only, no pdf.js, so they unit-test under jsdom.
import styles from './Reader.module.css'

/** [P2-02] Opaque anchor shape stored (JSON-stringified) as `HighlightRecord.anchor` —
 * character offsets into the current page's text layer container, walking
 * text nodes in DOM order. Re-locatable via `rangeFromAnchor` as long as the
 * page's text layer renders the same text content in the same order (true
 * for a fixed PDF page — scale/zoom only affects layout, not text-node
 * order). Kept as plain offsets (not e.g. a CSS selector) so it survives
 * across zoom levels without re-derivation. */
export interface HighlightAnchor {
  start: number
  end: number
}

/**
 * Serialize a DOM `Range` inside `container` into character offsets over
 * `container`'s text nodes (document order) — the opaque anchor a highlight
 * is stored under and later re-located from (`rangeFromAnchor`). Returns
 * null if the range's start/end containers aren't found while walking
 * `container`'s text nodes (e.g. the selection isn't actually inside it).
 */
export function anchorFromRange(container: Node, range: Range): HighlightAnchor | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let start = -1
  let end = -1
  let node: Node | null = walker.nextNode()
  while (node) {
    const length = (node as Text).data.length
    if (start === -1 && node === range.startContainer) start = offset + range.startOffset
    if (node === range.endContainer) end = offset + range.endOffset
    offset += length
    node = walker.nextNode()
  }
  if (start === -1 || end === -1 || end <= start) return null
  return { start, end }
}

/**
 * Inverse of `anchorFromRange`: reconstruct a `Range` covering `anchor`'s
 * character span inside `container`'s current text nodes. Returns null if
 * the anchor no longer fits (e.g. the page re-rendered with different/less
 * text than when the highlight was created) rather than throwing — a stale
 * highlight should be silently skipped, not crash the reader.
 */
export function rangeFromAnchor(container: Node, anchor: HighlightAnchor): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let startSet = false
  let endSet = false
  const range = document.createRange()
  let node: Node | null = walker.nextNode()
  while (node && !(startSet && endSet)) {
    const length = (node as Text).data.length
    if (!startSet && anchor.start >= offset && anchor.start <= offset + length) {
      range.setStart(node, anchor.start - offset)
      startSet = true
    }
    if (!endSet && anchor.end >= offset && anchor.end <= offset + length) {
      range.setEnd(node, anchor.end - offset)
      endSet = true
    }
    offset += length
    node = walker.nextNode()
  }
  if (!startSet || !endSet) return null
  return range
}

// ---------------------------------------------------------------------------
// [P2-03] Inline citation click-through.
//
// References are not structured data anywhere in a PDF — the only signal is
// the raw per-page text pdf.js's text layer already extracts. Detection is
// therefore two passes over that text, both pure/DOM-free (unit-testable
// without rendering anything):
//
//   1. `buildReferenceIndex` scans a loaded document's per-page text once
//      (on doc load, memoized in Reader's `referenceIndex` state — never
//      rescanned on page/zoom changes) for a "References"/"Bibliography"
//      heading, then parses `[n] ...` entries on/after that page into a
//      number → { page, text } map.
//   2. `injectCitationMarkers` runs after each page's text layer renders and
//      wraps `[n]`/`[n, m]`/`[n-m]`-shaped substrings whose number(s) resolve
//      in that index in a clickable `<button>` — everything else (including
//      unresolved markers, when no references section was found at all)
//      stays plain text, so a paper with no detectable bibliography is
//      simply inert rather than broken.
// ---------------------------------------------------------------------------

/** One parsed reference-list entry: the number `[n]` was defined under, the
 * (1-based) page it was found on, and its trailing citation text (used for
 * the hover tooltip). */
export interface ReferenceEntry {
  number: number
  page: number
  text: string
}

/** Reference number → its entry. Empty when no references/bibliography
 * section was found (or the document has none) — callers treat an empty
 * index as "feature inert", not an error. */
export type ReferenceIndex = Map<number, ReferenceEntry>

/** Matches an inline citation marker's bracket contents: a single number, a
 * comma-separated list (`1, 2`), a dash range (`3-5`), or any mix of those
 * (`1, 3-5, 7`). Capture group 1 is the raw contents between the brackets. */
const INLINE_CITATION_REGEX = /\[(\d+(?:\s*[-,]\s*\d+)*)\]/g

/** A page-local text heading that marks the start of the reference list.
 * Checked against a single text item's trimmed content (headings are
 * typically their own text-layer item), not a whole page's joined text. */
const REFERENCES_HEADING_REGEX = /^(references|bibliography)$/i

/** Largest `[n-m]` range span (inclusive) `expandCitationNumbers` will
 * expand. A garbled PDF's text layer can produce nonsense like
 * `[1-999999999]`; without a cap that would synchronously allocate a
 * near-billion-element array inside a render-effect and hang the UI.
 * Reference lists are never remotely this large, so any range wider than
 * this is treated as garbage and dropped entirely (not clamped — clamping
 * would silently attach the marker to a wrong/arbitrary reference). */
const MAX_CITATION_RANGE_SPAN = 100

/**
 * Expand a citation marker's raw bracket contents (e.g. `"3-5"`, `"1, 2"`,
 * `"1, 3-5, 7"`) into the individual reference numbers it covers. Malformed
 * fragments (neither a bare number nor a `n-m` range) are silently dropped
 * rather than throwing, as is any range wider than `MAX_CITATION_RANGE_SPAN`
 * (garbled-PDF guard — see that constant's doc comment).
 */
export function expandCitationNumbers(raw: string): number[] {
  const numbers: number[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (end - start > MAX_CITATION_RANGE_SPAN) continue
      for (let n = start; n <= end; n += 1) numbers.push(n)
    } else if (/^\d+$/.test(trimmed)) {
      numbers.push(Number(trimmed))
    }
  }
  return numbers
}

/**
 * Build a reference index from a document's per-page text, given as one
 * string array per page (the order `page.getTextContent()`'s `items`
 * naturally come in — Reader passes each item's `.str`). Finds the first
 * page whose text contains a standalone "References"/"Bibliography"
 * heading, then parses `[n] ...` entries from that page onward (a heading
 * and its list commonly share a page). The first occurrence of a given
 * number wins if a reference is (mis-)detected more than once. Returns an
 * empty map — not an error — when no heading is found at all.
 */
export function buildReferenceIndex(pages: string[][]): ReferenceIndex {
  const index: ReferenceIndex = new Map()

  let startPage = -1
  outer: for (let i = 0; i < pages.length; i += 1) {
    for (const item of pages[i]) {
      for (const line of item.split(/\r?\n/)) {
        if (REFERENCES_HEADING_REGEX.test(line.trim())) {
          startPage = i
          break outer
        }
      }
    }
  }
  if (startPage === -1) return index

  const entryStartRegex = /\[(\d+)\]\s*/g
  for (let i = startPage; i < pages.length; i += 1) {
    const pageText = pages[i].join(' ')
    entryStartRegex.lastIndex = 0
    const starts: Array<{ number: number; markerStart: number; contentStart: number }> = []
    let match: RegExpExecArray | null
    while ((match = entryStartRegex.exec(pageText))) {
      starts.push({ number: Number(match[1]), markerStart: match.index, contentStart: entryStartRegex.lastIndex })
    }
    for (let s = 0; s < starts.length; s += 1) {
      const current = starts[s]
      const next = starts[s + 1]
      const text = pageText.slice(current.contentStart, next ? next.markerStart : undefined).trim()
      if (!index.has(current.number)) {
        index.set(current.number, { number: current.number, page: i + 1, text })
      }
    }
  }

  return index
}

/**
 * Walk `container`'s text nodes (as rendered by pdf.js's `TextLayer`, one
 * `<span>` per text item) and replace any `[n]`/`[n, m]`/`[n-m]` marker whose
 * number(s) resolve in `referenceIndex` with a `<button data-citation-number
 * ="n">` carrying the same visible text — a plain-DOM-mutation seam, tested
 * without rendering pdf.js. Markers whose number(s) don't resolve (including
 * every marker when `referenceIndex` is empty — no references section
 * found) are left untouched as plain text. Total text content is preserved
 * exactly, so callers that re-derive character offsets over the container
 * (e.g. highlight anchors) keep working unaffected. Idempotent: text already
 * inside an injected marker is skipped, so re-running after the reference
 * index arrives (or on a re-render signal) never nests buttons.
 */
export function injectCitationMarkers(container: HTMLElement, referenceIndex: ReferenceIndex): void {
  if (referenceIndex.size === 0) return

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node: Node | null = walker.nextNode()
  while (node) {
    if (!node.parentElement?.closest('[data-citation-number]')) textNodes.push(node as Text)
    node = walker.nextNode()
  }

  for (const textNode of textNodes) {
    const data = textNode.data
    INLINE_CITATION_REGEX.lastIndex = 0
    const matches: Array<{ index: number; length: number; primary: number }> = []
    let match: RegExpExecArray | null
    while ((match = INLINE_CITATION_REGEX.exec(data))) {
      const numbers = expandCitationNumbers(match[1])
      const primary = numbers.find((n) => referenceIndex.has(n))
      if (primary !== undefined) matches.push({ index: match.index, length: match[0].length, primary })
    }
    if (matches.length === 0) continue

    const parent = textNode.parentNode
    if (!parent) continue

    const fragment = document.createDocumentFragment()
    let cursor = 0
    for (const m of matches) {
      if (m.index > cursor) fragment.appendChild(document.createTextNode(data.slice(cursor, m.index)))
      const raw = data.slice(m.index, m.index + m.length)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = styles.citationMarker
      button.textContent = raw
      button.setAttribute('data-citation-number', String(m.primary))
      button.setAttribute('aria-label', `Jump to reference ${m.primary}`)
      fragment.appendChild(button)
      cursor = m.index + m.length
    }
    if (cursor < data.length) fragment.appendChild(document.createTextNode(data.slice(cursor)))
    parent.replaceChild(fragment, textNode)
  }
}

/**
 * Case-insensitive, non-overlapping occurrences of `query` in `container`'s
 * concatenated text, as anchors usable with `rangeFromAnchor`. Used to mark
 * search hits on each rendered page. Empty for a blank query.
 */
export function findTextMatches(container: Node, query: string): HighlightAnchor[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const haystack = (container.textContent ?? '').toLowerCase()
  const matches: HighlightAnchor[] = []
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    matches.push({ start: index, end: index + needle.length })
    index = haystack.indexOf(needle, index + needle.length)
  }
  return matches
}
