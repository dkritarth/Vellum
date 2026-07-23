// Reader — center-pane PDF viewer [P1-09].
//
// Loads `data/papers/<slug>/paper.pdf` bytes via the `window.vellum`
// preload bridge (renderer never touches fs/node directly — see
// electron/preload.ts `readPaperFile`), then renders pages with pdf.js:
// a <canvas> for the raster page plus a pdf.js `TextLayer` overlay so the
// page text is selectable (enables later highlight / ask-about-selection,
// [P2-02]/[P1-10]).
//
// pdf.js worker: pdf.js insists on running text/font parsing off the main
// thread via a Worker. `pdfjs-dist/build/pdf.worker.mjs?url` is Vite's
// `?url` asset import — electron-vite (which wraps Vite) resolves it to a
// fingerprinted, bundled URL at build time, so the worker file ships
// correctly in dev (electron-vite dev) and in the packaged app (electron-vite
// build) with zero extra config. `GlobalWorkerOptions.workerSrc` is set once
// at module load, before any `getDocument()` call.
//
// No paper/slug is wired up yet (library + open-in-tab land in later P1
// cards), so `slug` is optional and undefined by default — the empty state
// below is what App.tsx shows today.
import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { HighlightColor } from './ReaderToolbar'
import type { HighlightRecord } from '../../core/highlights/repo'
import styles from './Reader.module.css'

GlobalWorkerOptions.workerSrc = workerSrc

export const MIN_SCALE = 0.5
export const MAX_SCALE = 3
export const SCALE_STEP = 0.25
export const DEFAULT_SCALE = 1

/** Clamp a requested page number into `[1, numPages]`. `numPages <= 0` (no doc yet) clamps to 1. */
export function clampPage(page: number, numPages: number): number {
  if (numPages <= 0) return 1
  return Math.min(Math.max(page, 1), numPages)
}

/** Clamp a requested zoom scale into `[MIN_SCALE, MAX_SCALE]`. */
export function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)
}

/** Case-insensitive count of non-overlapping occurrences of `query` in `text`. */
export function countOccurrences(text: string, query: string): number {
  if (!query) return 0
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

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

export interface OutlineItem {
  title: string
  pageNumber: number | null
  items: OutlineItem[]
}

/** Raw pdf.js outline node shape (subset of pdfjs-dist's getOutline() result) we consume. */
export interface RawOutlineNode {
  title: string
  dest: string | unknown[] | null
  items: RawOutlineNode[]
}

export interface SearchMatch {
  pageNumber: number
  count: number
}

/**
 * Resolve a pdf.js outline (as returned by `PDFDocumentProxy.getOutline()`)
 * into a tree of `{ title, pageNumber, items }`, walking named/explicit
 * destinations down to a 1-based page number via `getPageIndex`. A node
 * whose destination can't be resolved gets `pageNumber: null` (rendered
 * non-clickable) rather than throwing — a malformed outline shouldn't crash
 * the reader.
 */
export async function resolveOutline(pdf: PDFDocumentProxy, nodes: RawOutlineNode[]): Promise<OutlineItem[]> {
  return Promise.all(
    nodes.map(async (node) => {
      const pageNumber = await resolveDestPage(pdf, node.dest)
      const items = await resolveOutline(pdf, node.items ?? [])
      return { title: node.title, pageNumber, items }
    }),
  )
}

// pdf.js's `RefProxy` type ({ num, gen }, per its display/api.d.ts) isn't
// re-exported from the package's top-level entry point, so it's reproduced
// structurally here rather than imported.
interface PdfRefProxy {
  num: number
  gen: number
}

function isRefProxy(value: unknown): value is PdfRefProxy {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { num?: unknown }).num === 'number' &&
    typeof (value as { gen?: unknown }).gen === 'number'
  )
}

async function resolveDestPage(pdf: PDFDocumentProxy, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicitDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    const ref = Array.isArray(explicitDest) ? explicitDest[0] : null
    // pdf.js's own explicit-destination array is untyped (`Array<any>`) in
    // its declarations; the first element is documented (pdf.js source,
    // display/api.js `Catalog#getDestination`) to be a RefProxy `{num, gen}`
    // pointing at the target page. Narrow with a runtime shape check instead
    // of trusting an unjustified cast.
    if (!isRefProxy(ref)) return null
    const pageIndex = await pdf.getPageIndex(ref)
    return pageIndex + 1
  } catch {
    return null
  }
}

/** Search every page's text content for `query`, returning one entry per page with >0 hits. */
export async function searchDocument(pdf: PDFDocumentProxy, query: string): Promise<SearchMatch[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const results: SearchMatch[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    const count = countOccurrences(pageText, trimmed)
    if (count > 0) results.push({ pageNumber, count })
  }
  return results
}

/** One highlight's rendered overlay rect, positioned relative to the text
 * layer container (`pageLayer`'s coordinate space). */
interface OverlayRect {
  id: string
  color: string
  flash: boolean
  left: number
  top: number
  width: number
  height: number
}

interface ReaderProps {
  /** Paper slug (data/papers/<slug>/). Undefined = no paper open (empty state). */
  slug?: string
  /** [P2-02] Highlight tool state, lifted to App so ReaderToolbar (a sibling)
   * can drive it. `undefined`/inactive = plain text selection, no capture. */
  highlightTool?: { active: boolean; color: HighlightColor }
  /** [P2-02] Jump seam: set by the Annotations tab (via App) to drive the
   * reader to a highlight's page and briefly flash it. `nonce` makes
   * re-jumping to the same target (clicked twice in a row) re-trigger the
   * effect even though `page`/`highlightId` didn't change. */
  jumpTarget?: { page: number; highlightId: string; nonce: number } | null
}

const FLASH_DURATION_MS = 1500

export function Reader({ slug, highlightTool, jumpTarget }: ReaderProps): JSX.Element {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [textLayerVersion, setTextLayerVersion] = useState(0)
  const [overlays, setOverlays] = useState<OverlayRect[]>([])
  const [flashId, setFlashId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)

  // Load the document whenever the open paper changes.
  useEffect(() => {
    let cancelled = false

    setDoc(null)
    setNumPages(0)
    setPageNumber(1)
    setOutline([])
    setSearchQuery('')
    setSearchResults([])
    setSearchIndex(0)
    setError(null)
    setHighlights([])

    if (!slug) return

    setLoading(true)
    void (async () => {
      try {
        const bytes = await window.vellum.readPaperFile(slug)
        if (cancelled) return
        if (!bytes) {
          setError('No PDF found for this paper.')
          return
        }
        const pdf = await getDocument({ data: bytes }).promise
        if (cancelled) return
        setDoc(pdf)
        setNumPages(pdf.numPages)

        const rawOutline = (await pdf.getOutline()) as RawOutlineNode[] | null
        if (cancelled) return
        setOutline(rawOutline ? await resolveOutline(pdf, rawOutline) : [])
      } catch {
        if (!cancelled) setError('Could not open this PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    void window.vellum
      .highlightsList(slug)
      .then((records) => {
        if (!cancelled) setHighlights(records)
      })
      .catch(() => {
        if (!cancelled) setHighlights([])
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  // Jump seam: drive the reader to a highlight's page and flash it briefly.
  // Fires on every `jumpTarget` change (the caller bumps `nonce` so clicking
  // the same annotation twice re-triggers the flash even though page/id
  // didn't change).
  useEffect(() => {
    if (!jumpTarget) return
    setPageNumber(clampPage(jumpTarget.page, numPages))
    setFlashId(jumpTarget.highlightId)
    const timer = setTimeout(() => setFlashId(null), FLASH_DURATION_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- numPages intentionally excluded: re-clamping on every doc load isn't the intent, only on an actual jump request.
  }, [jumpTarget])

  // Render the current page (canvas + selectable text layer) on page/zoom change.
  useEffect(() => {
    if (!doc) return
    let cancelled = false

    void (async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        // jsdom (unit tests) returns null for 2d context — real Chromium
        // renderer always has one. Guard rather than crash either way.
        if (ctx) {
          await page.render({ canvasContext: ctx, canvas, viewport }).promise
        }
      }
      if (cancelled) return

      const textLayerContainer = textLayerRef.current
      if (textLayerContainer) {
        textLayerContainer.innerHTML = ''
        textLayerContainer.style.width = `${viewport.width}px`
        textLayerContainer.style.height = `${viewport.height}px`
        const textContent = await page.getTextContent()
        if (cancelled) return
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport,
        })
        await textLayer.render()
        if (cancelled) return
        // Bumps the overlay-recompute effect below — the text layer's DOM
        // (needed to re-locate highlight anchors) only exists after this
        // await resolves.
        setTextLayerVersion((version) => version + 1)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, scale])

  // Recompute highlight overlay rects whenever the highlight list, current
  // page, or the rendered text layer itself changes. Anchors that no longer
  // resolve (stale page content) are silently skipped — see `rangeFromAnchor`.
  useEffect(() => {
    const container = textLayerRef.current
    if (!container) {
      setOverlays([])
      return
    }

    const next: OverlayRect[] = []
    const containerRect = container.getBoundingClientRect()
    for (const highlight of highlights) {
      if (highlight.page !== pageNumber) continue
      let anchor: HighlightAnchor
      try {
        anchor = JSON.parse(highlight.anchor) as HighlightAnchor
      } catch {
        continue
      }
      const range = rangeFromAnchor(container, anchor)
      if (!range) continue
      for (const rect of Array.from(range.getClientRects())) {
        next.push({
          id: highlight.id,
          color: highlight.color,
          flash: highlight.id === flashId,
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
        })
      }
    }
    setOverlays(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- textLayerVersion is the "has the DOM actually re-rendered" signal; highlights/pageNumber/flashId are the real deps.
  }, [highlights, pageNumber, textLayerVersion, flashId])

  function goToPage(next: number): void {
    setPageNumber(clampPage(next, numPages))
  }

  function zoomBy(delta: number): void {
    setScale((current) => clampScale(current + delta))
  }

  // [P2-02] Highlight capture: when the highlight tool is active, a mouseup
  // inside the text layer with a non-collapsed selection creates a
  // highlight from that selection (page, quote, anchor) and clears the
  // native selection so it doesn't linger visually once the overlay paints.
  function handleTextLayerMouseUp(): void {
    if (!highlightTool?.active || !slug) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

    const container = textLayerRef.current
    if (!container) return
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return

    const quote = selection.toString().trim()
    if (!quote) return
    const anchor = anchorFromRange(container, range)
    if (!anchor) return

    const page = pageNumber
    const color = highlightTool.color
    void window.vellum
      .highlightsCreate({ slug, page, color, quote, anchor: JSON.stringify(anchor) })
      .then((record) => {
        setHighlights((current) => [...current, record])
        selection.removeAllRanges()
      })
      .catch(() => undefined)
  }

  async function runSearch(query: string): Promise<void> {
    setSearchQuery(query)
    if (!doc || !query.trim()) {
      setSearchResults([])
      setSearchIndex(0)
      return
    }
    setSearching(true)
    try {
      const results = await searchDocument(doc, query)
      setSearchResults(results)
      setSearchIndex(0)
      if (results.length > 0) goToPage(results[0].pageNumber)
    } finally {
      setSearching(false)
    }
  }

  function stepMatch(delta: number): void {
    if (searchResults.length === 0) return
    const next = (searchIndex + delta + searchResults.length) % searchResults.length
    setSearchIndex(next)
    goToPage(searchResults[next].pageNumber)
  }

  if (!slug) {
    return (
      <div className={styles.reader}>
        <div className={styles.empty}>
          <p>No paper open</p>
          <p className={styles.emptyHint}>Open a paper from Library to start reading.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.reader}>
        <div className={styles.empty}>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.reader}>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => setTocOpen((open) => !open)} aria-pressed={tocOpen}>
          Outline
        </button>

        <div className={styles.pageNav}>
          <button type="button" onClick={() => goToPage(pageNumber - 1)} disabled={!doc || pageNumber <= 1}>
            ‹
          </button>
          <span aria-label="Page">
            {doc ? pageNumber : '–'} of {doc ? numPages : '–'}
          </span>
          <button type="button" onClick={() => goToPage(pageNumber + 1)} disabled={!doc || pageNumber >= numPages}>
            ›
          </button>
        </div>

        <div className={styles.zoom}>
          <button type="button" onClick={() => zoomBy(-SCALE_STEP)} disabled={!doc || scale <= MIN_SCALE}>
            −
          </button>
          <span aria-label="Zoom">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoomBy(SCALE_STEP)} disabled={!doc || scale >= MAX_SCALE}>
            +
          </button>
        </div>

        <form
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch(searchQuery)
          }}
        >
          <input
            type="search"
            aria-label="Search in document"
            placeholder="Search…"
            value={searchQuery}
            disabled={!doc}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button type="submit" disabled={!doc || searching}>
            Search
          </button>
          {searchResults.length > 0 ? (
            <>
              <span aria-label="Search matches">
                {searchIndex + 1} / {searchResults.length}
              </span>
              <button type="button" aria-label="Previous match" onClick={() => stepMatch(-1)}>
                ‹
              </button>
              <button type="button" aria-label="Next match" onClick={() => stepMatch(1)}>
                ›
              </button>
            </>
          ) : searchQuery && !searching ? (
            <span aria-label="Search matches">0 / 0</span>
          ) : null}
        </form>
      </div>

      <div className={styles.body}>
        {tocOpen ? (
          <nav className={styles.toc} aria-label="Table of contents">
            {outline.length === 0 ? (
              <p className={styles.tocEmpty}>No outline in this PDF.</p>
            ) : (
              <OutlineList items={outline} onSelect={goToPage} />
            )}
          </nav>
        ) : null}

        <div className={styles.pageViewport}>
          {loading ? <p className={styles.loading}>Loading…</p> : null}
          <div className={styles.pageLayer}>
            <canvas ref={canvasRef} className={styles.canvas} />
            <div
              ref={textLayerRef}
              className={styles.textLayer}
              data-highlight-mode={highlightTool?.active ? 'active' : undefined}
              onMouseUp={handleTextLayerMouseUp}
            />
            <div className={styles.highlightOverlay} aria-hidden="true">
              {overlays.map((overlay, index) => (
                <div
                  key={`${overlay.id}-${index}`}
                  className={overlay.flash ? `${styles.highlightRect} ${styles.highlightRectFlash}` : styles.highlightRect}
                  style={{
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    height: overlay.height,
                    background: overlay.color,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OutlineList({ items, onSelect }: { items: OutlineItem[]; onSelect: (page: number) => void }): JSX.Element {
  return (
    <ul className={styles.tocList}>
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          <button
            type="button"
            className={styles.tocItem}
            disabled={item.pageNumber === null}
            onClick={() => item.pageNumber !== null && onSelect(item.pageNumber)}
          >
            {item.title}
          </button>
          {item.items.length > 0 ? <OutlineList items={item.items} onSelect={onSelect} /> : null}
        </li>
      ))}
    </ul>
  )
}
