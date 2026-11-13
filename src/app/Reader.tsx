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
// Layout (#198): every page sits in one vertical scroll column at its zoomed
// size; only pages near the viewport mount a canvas + text layer (see
// ReaderPage). Zoom (#199) comes from the toolbar, Ctrl/Cmd +/-/0, and
// trackpad pinch / Ctrl+wheel, anchored at the cursor or pane centre.
//
// `slug` is optional and undefined when no paper is open (empty state).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import type { HighlightColor } from './ReaderToolbar'
import type { HighlightRecord } from '../../core/highlights/repo'
import { CitationTooltip } from './CitationTooltip'
import { ReaderPage } from './ReaderPage'
import { SelectionMenu } from './SelectionMenu'
import { anchorFromRange, buildReferenceIndex, type HighlightAnchor, type ReferenceIndex } from './readerText'
import {
  captureZoomAnchor,
  pagesInWindow,
  pickCurrentPage,
  restoreZoomAnchor,
  steppedScale,
  wheelZoomFactor,
  zoomKeyAction,
  type PageBox,
  type ZoomAnchor,
} from './readerViewport'
import styles from './Reader.module.css'

export {
  anchorFromRange,
  buildReferenceIndex,
  expandCitationNumbers,
  findTextMatches,
  injectCitationMarkers,
  rangeFromAnchor,
  type HighlightAnchor,
  type ReferenceEntry,
  type ReferenceIndex,
} from './readerText'

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
  /** Active paper invalidation count after a persisted highlight change. */
  highlightsRevision?: number
  /** Successful persisted creation, scoped to the originating paper. Never sent on failure. */
  onHighlightCreated?: (paperSlug: string) => void
  /** [R1-05] Callback when user clicks 'Add to chat' on selected text */
  onAddToChat?: (quote: string, page: number) => void
  /** [R1-05] Callback when user clicks 'Explain' on selected text */
  onExplain?: (quote: string, page: number) => void
}

const FLASH_DURATION_MS = 1500
/** Delay after the last zoom change before pages re-rasterise at the new
 * scale. Until then the previous canvases are stretched. */
const RENDER_SCALE_DEBOUNCE_MS = 150
/** Zoom events closer together than this (at the same cursor point) are one
 * gesture and share a zoom anchor. */
const GESTURE_IDLE_MS = 250
/** Space left above a page when jumping to it. */
const JUMP_TOP_MARGIN_PX = 8

const NO_HIGHLIGHTS: HighlightRecord[] = []

/** Where the reader was in a paper: zoom plus the page point at the top
 * centre of the pane. Kept per slug for the session so switching tabs or
 * visiting Library and coming back doesn't reset to page 1 / 100% (#202). */
interface ReaderViewState {
  scale: number
  page: number
  fx: number
  fy: number
}

const viewStateBySlug = new Map<string, ReaderViewState>()

/** Test hook: forget remembered positions/zoom. */
export function clearReaderViewState(): void {
  viewStateBySlug.clear()
}

function topAnchorPoint(viewport: HTMLElement): { x: number; y: number } {
  const rect = viewport.getBoundingClientRect()
  return { x: rect.left + viewport.clientWidth / 2, y: rect.top + 1 }
}

interface PageSize {
  width: number
  height: number
}

interface ActiveSelection {
  x: number
  y: number
  quote: string
  page: number
  /** Null when the selection crosses pages: Ask/Explain still work, but a
   * highlight needs a single-page anchor. */
  anchor: HighlightAnchor | null
}

type HighlightInput = Parameters<Window['vellum']['highlightsCreate']>[0]

// One save intent captures its original context. Identity retires late UI work;
// persistence can still finish and notify the originating paper.
interface HighlightSave {
  input: HighlightInput
  status: 'pending' | 'failed'
}

/** Page, text layer, quote and single-page anchor of a live selection, or null
 * when it does not start inside one of this reader's text layers. */
function selectionContext(
  selection: Selection,
  pages: HTMLElement | null,
): { page: number; layer: HTMLElement; quote: string; anchor: HighlightAnchor | null; range: Range } | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const startNode = range.startContainer
  const startEl = startNode instanceof Element ? startNode : startNode.parentElement
  const layer = startEl?.closest<HTMLElement>('[data-text-layer]')
  const page = Number(layer?.closest<HTMLElement>('[data-page-slot]')?.dataset.pageNumber)
  if (!layer || !pages?.contains(layer) || !page) return null
  const quote = selection.toString().trim()
  if (!quote) return null
  const anchor = layer.contains(range.endContainer) ? anchorFromRange(layer, range) : null
  return { page, layer, quote, anchor, range }
}

export function Reader({
  slug,
  highlightTool,
  jumpTarget,
  onAddToChat,
  onExplain,
  onHighlightCreated,
  highlightsRevision = 0,
}: ReaderProps): JSX.Element {
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null)
  const [highlightSave, setHighlightSave] = useState<HighlightSave | null>(null)
  const currentSave = useRef<HighlightSave | null>(null)
  const pendingSelections = useRef(new Set<string>())
  const retryRef = useRef<HTMLButtonElement>(null)
  // Each highlight refresh owns its result. Local creations also retire outstanding reads.
  const highlightRequest = useRef(0)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageSizes, setPageSizes] = useState<PageSize[]>([])
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [renderScale, setRenderScale] = useState(DEFAULT_SCALE)
  const [renderWindow, setRenderWindow] = useState({ first: 1, last: 1 })
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // The query the current results belong to; hits are marked for it.
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchFocus, setSearchFocus] = useState<{ page: number; nonce: number } | null>(null)
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [flashId, setFlashId] = useState<string | null>(null)
  // [P2-03] Built once per loaded doc (see the doc-load effect) from a
  // single pass over every page's text — never rescanned on page/zoom
  // changes. Empty when no references section was found (feature inert).
  const [referenceIndex, setReferenceIndex] = useState<ReferenceIndex>(new Map())
  const [citationFlash, setCitationFlash] = useState<{ page: number; number: number } | null>(null)
  const [hoveredCitation, setHoveredCitation] = useState<{ text: string; left: number; top: number } | null>(null)
  // Page where the current text selection started. It stays mounted even
  // when scrolled out of the render window, so a long drag-selection (or
  // an open selection menu) keeps its anchor text.
  const [pinnedPage, setPinnedPage] = useState<number | null>(null)

  const numPages = pageSizes.length
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  viewportRef.current = viewportEl
  const pagesRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  // Page a programmatic jump targeted. While it stays visible, the
  // indicator keeps showing it (e.g. the last page at low zoom can't be
  // scrolled to the top, so "most visible" would report the page before).
  // Cleared by any user scroll input.
  const pageLockRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const gestureAnchorRef = useRef<{ anchor: ZoomAnchor; time: number } | null>(null)
  const slugRef = useRef(slug)
  slugRef.current = slug

  const saveViewState = useCallback((): void => {
    const viewport = viewportRef.current
    const current = slugRef.current
    if (!viewport || !current) return
    const { x, y } = topAnchorPoint(viewport)
    const anchor = captureZoomAnchor(viewport, x, y)
    if (!anchor) return
    viewStateBySlug.set(current, { scale: scaleRef.current, page: anchor.page, fx: anchor.fx, fy: anchor.fy })
  }, [])

  // Load the document whenever the open paper changes.
  useEffect(() => {
    let cancelled = false

    setDoc(null)
    setPageSizes([])
    setPageNumber(1)
    setRenderWindow({ first: 1, last: 1 })
    setOutline([])
    setSearchQuery('')
    setSubmittedQuery('')
    setSearchResults([])
    setSearchIndex(0)
    setSearchFocus(null)
    setError(null)
    setHighlights([])
    setReferenceIndex(new Map())
    setCitationFlash(null)
    setHoveredCitation(null)
    setActiveSelection(null)
    pageLockRef.current = null
    setPinnedPage(null)
    // A scroll frame queued for the previous paper must not save its
    // position under the new slug.
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }

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
        const pdf = await getDocument({
          data: bytes,
          standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href,
          wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href,
          // Workers cannot fetch file:// resources. PDF.js's display factory
          // uses local XHR, preserving the existing CSP and renderer isolation.
          useWorkerFetch: false,
        }).promise
        if (cancelled) return

        // Every page's unscaled size up front, so the scroll column has its
        // full, correct height before any page renders (#198).
        // Requested in parallel: one worker round-trip each.
        const sizes: PageSize[] = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, i) => {
            const viewport = (await pdf.getPage(i + 1)).getViewport({ scale: 1 })
            return { width: viewport.width, height: viewport.height }
          }),
        )
        if (cancelled) return
        // Zoom is per paper: the remembered one, else the default.
        const restoredScale = viewStateBySlug.get(slug)?.scale ?? DEFAULT_SCALE
        scaleRef.current = restoredScale
        setScale(restoredScale)
        setRenderScale(restoredScale)
        setPageSizes(sizes)
        setDoc(pdf)
        setLoading(false)

        const rawOutline = (await pdf.getOutline()) as RawOutlineNode[] | null
        if (cancelled) return
        setOutline(rawOutline ? await resolveOutline(pdf, rawOutline) : [])

        // [P2-03] One pass over every page's text to build the reference
        // index — done once per doc load (not on every page/zoom change).
        const pagesText: string[][] = []
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const textContent = await page.getTextContent()
          if (cancelled) return
          pagesText.push(textContent.items.map((item) => ('str' in item ? item.str : '')))
        }
        if (cancelled) return
        setReferenceIndex(buildReferenceIndex(pagesText))
      } catch (err: unknown) {
        console.error('[Reader] Failed to load PDF:', err)
        if (!cancelled) setError('Could not open this PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    const version = ++highlightRequest.current
    if (!slug) return
    const isCurrent = (): boolean => slugRef.current === slug && highlightRequest.current === version
    void window.vellum
      .highlightsList(slug)
      .then((records) => {
        if (isCurrent()) setHighlights(records)
      })
      .catch(() => {
        if (isCurrent()) setHighlights([])
      })
    return () => {
      highlightRequest.current += 1
    }
  }, [slug, highlightsRevision])

  function retireHighlightSave(): void {
    currentSave.current = null
    setHighlightSave(null)
  }

  // A paper switch or re-rasterised zoom retires the captured save context
  // (its text layer is replaced). Scrolling alone keeps it: pages stay mounted.
  useEffect(() => {
    retireHighlightSave()
    return () => {
      currentSave.current = null
    }
  }, [slug, renderScale])

  useEffect(() => {
    function handleSelectionChange(): void {
      const input = currentSave.current?.input
      const selection = window.getSelection()
      // Clicking Retry may collapse selection; captured intent must survive that.
      if (!input || !selection || selection.isCollapsed || selection.rangeCount === 0) return
      const context = selectionContext(selection, pagesRef.current)
      if (
        !context ||
        context.page !== input.page ||
        input.anchor !== JSON.stringify(context.anchor) ||
        input.quote !== context.quote
      ) {
        retireHighlightSave()
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  // Measure page slots and derive (a) which pages mount a canvas/text layer
  // and (b), for scroll-driven updates, the "N of M" page indicator.
  const updateViewport = useCallback((fromScroll: boolean): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const boxes: PageBox[] = Array.from(viewport.querySelectorAll<HTMLElement>('[data-page-slot]'), (el) => ({
      top: el.offsetTop,
      height: el.offsetHeight,
    }))
    if (boxes.length === 0) return
    const { scrollTop, clientHeight } = viewport
    const next = pagesInWindow(boxes, scrollTop, clientHeight, clientHeight)
    setRenderWindow((prev) => (prev.first === next.first && prev.last === next.last ? prev : next))
    if (!fromScroll) return
    const lock = pageLockRef.current
    if (lock !== null) {
      const box = boxes[lock - 1]
      if (box && box.top < scrollTop + clientHeight && box.top + box.height > scrollTop) {
        setPageNumber(lock)
        return
      }
      pageLockRef.current = null
    }
    setPageNumber(pickCurrentPage(boxes, scrollTop, clientHeight))
  }, [])

  // New document: return to the remembered position for this paper, or
  // start at the top-left; then compute the first render window.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !doc) return
    viewport.scrollTop = 0
    viewport.scrollLeft = 0
    const saved = slugRef.current ? viewStateBySlug.get(slugRef.current) : undefined
    if (saved) {
      const { x, y } = topAnchorPoint(viewport)
      restoreZoomAnchor(viewport, { page: saved.page, fx: saved.fx, fy: saved.fy, clientX: x, clientY: y })
      setPageNumber(saved.page)
    }
    updateViewport(false)
  }, [doc, updateViewport])

  // Pane resizes (window resize, TOC/right panel toggles) change how many
  // pages fit.
  useEffect(() => {
    if (!viewportEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateViewport(false))
    observer.observe(viewportEl)
    return () => observer.disconnect()
  }, [viewportEl, updateViewport])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    },
    [],
  )

  function handleScroll(): void {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      updateViewport(true)
      saveViewState()
    })
  }

  // Re-rasterise at the final zoom once the user stops zooming.
  useEffect(() => {
    if (renderScale === scale) return
    const timer = setTimeout(() => setRenderScale(scale), RENDER_SCALE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [scale, renderScale])

  /** Zoom to `target`, keeping the content under `(clientX, clientY)` — or
   * the pane centre — fixed on screen (#199). */
  const applyZoom = useCallback(
    (target: number, clientX?: number, clientY?: number): void => {
      const from = scaleRef.current
      const to = clampScale(Math.round(target * 1000) / 1000)
      if (to === from) return
      const viewport = viewportRef.current
      let anchor: ZoomAnchor | null = null
      if (viewport) {
        const rect = viewport.getBoundingClientRect()
        const x = clientX ?? rect.left + viewport.clientWidth / 2
        const y = clientY ?? rect.top + viewport.clientHeight / 2
        // A pinch is dozens of wheel events. Re-capturing the anchor after
        // each one accumulates the integer rounding of scroll offsets, so
        // reuse the gesture's first anchor while the cursor holds still.
        const now = performance.now()
        const previous = gestureAnchorRef.current
        anchor =
          previous &&
          now - previous.time < GESTURE_IDLE_MS &&
          Math.abs(previous.anchor.clientX - x) <= 2 &&
          Math.abs(previous.anchor.clientY - y) <= 2
            ? previous.anchor
            : captureZoomAnchor(viewport, x, y)
        gestureAnchorRef.current = anchor ? { anchor, time: now } : null
      }
      scaleRef.current = to
      // Commit the new layout synchronously so the anchor can be restored
      // against it before the browser paints.
      flushSync(() => {
        setScale(to)
        setActiveSelection(null)
        setHoveredCitation(null)
      })
      if (viewport && anchor) restoreZoomAnchor(viewport, anchor)
      updateViewport(false)
      saveViewState()
    },
    [updateViewport, saveViewState],
  )

  // Trackpad pinch (and Ctrl/Cmd + mouse wheel) arrives as a `wheel` event
  // with ctrlKey set. React's onWheel is passive, so preventDefault — which
  // stops Chromium zooming the whole page instead — needs a native listener.
  useEffect(() => {
    if (!viewportEl) return
    function handleWheel(event: WheelEvent): void {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        applyZoom(scaleRef.current * wheelZoomFactor(event.deltaY, event.deltaMode), event.clientX, event.clientY)
        return
      }
      pageLockRef.current = null
      gestureAnchorRef.current = null
    }
    viewportEl.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewportEl.removeEventListener('wheel', handleWheel)
  }, [viewportEl, applyZoom])

  // Cmd/Ctrl + = / - / 0 zoom the reader while focus is inside it — or on
  // <body>, which is where focus lands after e.g. the zoom button disables
  // itself at the bound. preventDefault stops Electron's menu zoom (#199).
  const readerRootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!doc) return
    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.defaultPrevented) return
      const action = zoomKeyAction(event)
      if (!action) return
      const active = document.activeElement
      const root = readerRootRef.current
      if (active && active !== document.body && !root?.contains(active)) return
      event.preventDefault()
      if (action === 'reset') applyZoom(DEFAULT_SCALE)
      else applyZoom(steppedScale(scaleRef.current, SCALE_STEP, action === 'in' ? 1 : -1))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [doc, applyZoom])

  function goToPage(next: number): void {
    const target = clampPage(next, numPages)
    retireHighlightSave()
    setActiveSelection(null)
    setPageNumber(target)
    pageLockRef.current = target
    const viewport = viewportRef.current
    const slot = viewport?.querySelector<HTMLElement>(`[data-page-slot][data-page-number="${target}"]`)
    if (viewport && slot) viewport.scrollTop = Math.max(0, slot.offsetTop - JUMP_TOP_MARGIN_PX)
  }

  // Jump seam: drive the reader to a highlight's page and flash it briefly.
  // Fires on every `jumpTarget` change (the caller bumps `nonce` so clicking
  // the same annotation twice re-triggers the flash even though page/id
  // didn't change). The page reveals the flashing rect once it renders.
  useEffect(() => {
    if (!jumpTarget) return
    goToPage(jumpTarget.page)
    setFlashId(jumpTarget.highlightId)
    const timer = setTimeout(() => setFlashId(null), FLASH_DURATION_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an actual jump request should move the reader.
  }, [jumpTarget])

  const highlightsByPage = useMemo(() => {
    const byPage = new Map<number, HighlightRecord[]>()
    for (const highlight of highlights) {
      const list = byPage.get(highlight.page)
      if (list) list.push(highlight)
      else byPage.set(highlight.page, [highlight])
    }
    return byPage
  }, [highlights])

  /** Position of `rect` relative to the page column (the coordinate space
   * the selection menu and citation tooltip are placed in). */
  function relativeToPages(rect: { left: number; top: number }): { left: number; top: number } {
    const pagesRect = pagesRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    return { left: rect.left - pagesRect.left, top: rect.top - pagesRect.top }
  }

  // [P2-02]/[R1-05] Selection capture on any page. With the highlight tool
  // active, a selection becomes a highlight; otherwise the selection menu
  // (Add to chat / Explain / highlight colours) opens above it.
  function handlePagesMouseUp(event: MouseEvent<HTMLDivElement>): void {
    if (!slug) return
    if ((event.target as HTMLElement).closest('[role="toolbar"]')) return
    const selection = window.getSelection()
    const context = selection ? selectionContext(selection, pagesRef.current) : null
    if (!context) {
      setActiveSelection(null)
      return
    }
    const { page, quote, anchor, range } = context

    // Mouseup on the selection already being saved (or awaiting Retry) is not a new intent.
    const previous = currentSave.current?.input
    if (
      previous &&
      previous.slug === slug &&
      previous.page === page &&
      previous.quote === quote &&
      previous.anchor === JSON.stringify(anchor)
    ) {
      return
    }
    retireHighlightSave()

    if (highlightTool?.active) {
      if (!anchor) return
      saveHighlight({ slug, page, color: highlightTool.color, quote, anchor: JSON.stringify(anchor) })
      return
    }

    const rangeRect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0 }
    const { left, top } = relativeToPages(rangeRect)
    setActiveSelection({ x: left + rangeRect.width / 2, y: top, quote, page, anchor })
  }

  function saveHighlight(input: HighlightInput): void {
    const key = JSON.stringify([input.slug, input.page, input.quote, input.anchor])
    if (currentSave.current?.status === 'pending' || pendingSelections.current.has(key)) return
    pendingSelections.current.add(key)
    const operation: HighlightSave = { input, status: 'pending' }
    currentSave.current = operation
    setHighlightSave(operation)
    setActiveSelection(null)
    void window.vellum
      .highlightsCreate(input)
      .then((record) => {
        pendingSelections.current.delete(key)
        onHighlightCreated?.(record.paperSlug)
        if (slugRef.current === record.paperSlug) {
          highlightRequest.current += 1
          setHighlights((current) => [...current, record])
        }
        if (currentSave.current !== operation) return
        if (document.activeElement === retryRef.current) viewportRef.current?.focus()
        window.getSelection()?.removeAllRanges()
        retireHighlightSave()
      })
      .catch(() => {
        pendingSelections.current.delete(key)
        if (currentSave.current !== operation) return
        const failed: HighlightSave = { input, status: 'failed' }
        currentSave.current = failed
        setHighlightSave(failed)
      })
  }

  function handleMenuHighlight(color: HighlightColor): void {
    if (!slug || !activeSelection?.anchor || currentSave.current) return
    const { page, quote, anchor } = activeSelection
    saveHighlight({ slug, page, color, quote, anchor: JSON.stringify(anchor) })
  }

  function handleMenuAddToChat(): void {
    if (!activeSelection) return
    onAddToChat?.(activeSelection.quote, activeSelection.page)
    setActiveSelection(null)
  }

  function handleMenuExplain(): void {
    if (!activeSelection) return
    onExplain?.(activeSelection.quote, activeSelection.page)
    setActiveSelection(null)
  }

  // [P2-03] Event delegation on the page column: React's synthetic click
  // bubbles up from any `<button data-citation-number>` the injection pass
  // created on any page, so it's found via `closest`.
  const citationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (citationTimerRef.current) clearTimeout(citationTimerRef.current)
    },
    [],
  )
  function handleCitationClick(event: MouseEvent<HTMLDivElement>): void {
    const target = (event.target as HTMLElement).closest('[data-citation-number]')
    if (!target) return
    const number = Number(target.getAttribute('data-citation-number'))
    const entry = referenceIndex.get(number)
    if (!entry) return
    setHoveredCitation(null)
    goToPage(entry.page)
    setCitationFlash({ page: entry.page, number })
    if (citationTimerRef.current) clearTimeout(citationTimerRef.current)
    citationTimerRef.current = setTimeout(() => setCitationFlash(null), FLASH_DURATION_MS)
  }

  function handleCitationMouseOver(event: MouseEvent<HTMLDivElement>): void {
    const target = (event.target as HTMLElement).closest('[data-citation-number]')
    if (!target) return
    const number = Number(target.getAttribute('data-citation-number'))
    const entry = referenceIndex.get(number)
    if (!entry) return
    const targetRect = target.getBoundingClientRect()
    const { left, top } = relativeToPages({ left: targetRect.left, top: targetRect.bottom })
    setHoveredCitation({ text: entry.text, left, top })
  }

  function handleCitationMouseOut(event: MouseEvent<HTMLDivElement>): void {
    const related = event.relatedTarget as HTMLElement | null
    if (related && related.closest('[data-citation-number]')) return
    setHoveredCitation(null)
  }

  function focusSearchResult(page: number): void {
    goToPage(page)
    setSearchFocus((current) => ({ page, nonce: (current?.nonce ?? 0) + 1 }))
  }

  function clearSearch(): void {
    setSearchQuery('')
    setSubmittedQuery('')
    setSearchResults([])
    setSearchIndex(0)
    setSearchFocus(null)
  }

  async function runSearch(query: string): Promise<void> {
    const trimmed = query.trim()
    if (!doc || !trimmed) {
      clearSearch()
      return
    }
    // Enter on an unchanged query steps to the next match.
    if (trimmed === submittedQuery && searchResults.length > 0) {
      stepMatch(1)
      return
    }
    setSearching(true)
    try {
      const results = await searchDocument(doc, trimmed)
      setSubmittedQuery(trimmed)
      setSearchResults(results)
      setSearchIndex(0)
      if (results.length > 0) focusSearchResult(results[0].pageNumber)
    } finally {
      setSearching(false)
    }
  }

  function stepMatch(delta: number): void {
    if (searchResults.length === 0) return
    const next = (searchIndex + delta + searchResults.length) % searchResults.length
    setSearchIndex(next)
    focusSearchResult(searchResults[next].pageNumber)
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

  const searchIsCurrent = submittedQuery !== '' && searchQuery.trim() === submittedQuery && !searching

  return (
    <div ref={readerRootRef} className={styles.reader}>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => setTocOpen((open) => !open)} aria-pressed={tocOpen}>
          Outline
        </button>

        <div className={styles.pageNav}>
          <button
            type="button"
            aria-label="Previous page"
            onClick={() => goToPage(pageNumber - 1)}
            disabled={!doc || pageNumber <= 1}
          >
            ‹
          </button>
          <span aria-label="Page">
            {doc ? pageNumber : '–'} of {doc ? numPages : '–'}
          </span>
          <button
            type="button"
            aria-label="Next page"
            onClick={() => goToPage(pageNumber + 1)}
            disabled={!doc || pageNumber >= numPages}
          >
            ›
          </button>
        </div>

        <div className={styles.zoom}>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => applyZoom(steppedScale(scale, SCALE_STEP, -1))}
            disabled={!doc || scale <= MIN_SCALE}
          >
            −
          </button>
          <span aria-label="Zoom">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => applyZoom(steppedScale(scale, SCALE_STEP, 1))}
            disabled={!doc || scale >= MAX_SCALE}
          >
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
            onChange={(event) => {
              const value = event.target.value
              setSearchQuery(value)
              // Editing (or clearing with the native ×) invalidates results.
              if (value.trim() !== submittedQuery) {
                setSubmittedQuery('')
                setSearchResults([])
                setSearchIndex(0)
                setSearchFocus(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                clearSearch()
              } else if (event.key === 'Enter' && event.shiftKey && searchResults.length > 0) {
                event.preventDefault()
                stepMatch(-1)
              }
            }}
          />
          <button type="submit" disabled={!doc || searching}>
            Search
          </button>
          {searchIsCurrent && searchResults.length > 0 ? (
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
          ) : searchIsCurrent ? (
            <span aria-label="Search matches">0 / 0</span>
          ) : null}
        </form>
      </div>

      {highlightSave ? (
        <div className={styles.highlightSave}>
          <p role={highlightSave.status === 'failed' ? 'alert' : 'status'}>
            {highlightSave.status === 'failed'
              ? 'Highlight was not saved. Retry to save this selection.'
              : 'Saving highlight…'}
          </p>
          <button
            ref={retryRef}
            type="button"
            aria-label="Retry saving highlight"
            disabled={highlightSave.status === 'pending'}
            onClick={() => saveHighlight(highlightSave.input)}
          >
            Retry
          </button>
        </div>
      ) : null}
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

        <div
          ref={setViewportEl}
          className={styles.pageViewport}
          data-reader-viewport=""
          tabIndex={0}
          aria-label="Document pages"
          onScroll={handleScroll}
          onPointerDown={() => {
            pageLockRef.current = null
          }}
          onKeyDown={(event) => {
            if (!event.ctrlKey && !event.metaKey) pageLockRef.current = null
          }}
        >
          {loading ? <p className={styles.loading}>Loading…</p> : null}
          <div
            ref={pagesRef}
            className={styles.pages}
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest('[role="toolbar"]')) return
              const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-page-slot]')
              setPinnedPage(slot ? Number(slot.dataset.pageNumber) : null)
            }}
            onMouseUp={handlePagesMouseUp}
            onClick={handleCitationClick}
            onMouseOver={handleCitationMouseOver}
            onMouseOut={handleCitationMouseOut}
          >
            {doc
              ? pageSizes.map((size, index) => {
                  const n = index + 1
                  return (
                    <ReaderPage
                      key={n}
                      doc={doc}
                      pageNumber={n}
                      baseWidth={size.width}
                      baseHeight={size.height}
                      scale={scale}
                      renderScale={renderScale}
                      active={(n >= renderWindow.first && n <= renderWindow.last) || n === pageNumber || n === pinnedPage}
                      highlightMode={Boolean(highlightTool?.active)}
                      referenceIndex={referenceIndex}
                      highlights={highlightsByPage.get(n) ?? NO_HIGHLIGHTS}
                      flashHighlightId={flashId}
                      citationFlash={citationFlash?.page === n ? citationFlash.number : null}
                      searchQuery={submittedQuery}
                      searchFocusNonce={searchFocus?.page === n ? searchFocus.nonce : null}
                    />
                  )
                })
              : null}
            {hoveredCitation ? (
              <CitationTooltip text={hoveredCitation.text} left={hoveredCitation.left} top={hoveredCitation.top} />
            ) : null}
            {activeSelection ? (
              <SelectionMenu
                x={activeSelection.x}
                y={activeSelection.y}
                quote={activeSelection.quote}
                page={activeSelection.page}
                canHighlight={activeSelection.anchor !== null}
                onAddToChat={handleMenuAddToChat}
                onExplain={handleMenuExplain}
                onHighlight={handleMenuHighlight}
                onClose={() => setActiveSelection(null)}
              />
            ) : null}
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
