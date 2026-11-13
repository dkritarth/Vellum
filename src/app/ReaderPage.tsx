// ReaderPage — one PDF page slot in the Reader's continuous scroll column
// (#198). The slot is always laid out at the page's zoomed size so scroll
// geometry is correct before anything renders; the canvas, text layer and
// overlays mount only while `active` (the page is in or near the viewport).
//
// Zoom model (#199): `scale` is the layout scale and changes on every
// pinch/wheel event. It drives the slot size and the pdf.js text layer via
// `--total-scale-factor`, so the text layer stays aligned without a
// re-render. `renderScale` trails it (debounced in Reader) and is the only
// thing that re-rasterises the canvas; until then the previous canvas is
// stretched to the new size.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { HighlightRecord } from '../../core/highlights/repo'
import {
  findTextMatches,
  injectCitationMarkers,
  rangeFromAnchor,
  type HighlightAnchor,
  type ReferenceIndex,
} from './readerText'
import { canvasOutputScale, revealInViewport } from './readerViewport'
import styles from './Reader.module.css'

/** One rendered overlay box, as fractions (0..1) of the page so it scales
 * with zoom without being recomputed. */
interface OverlayBox {
  key: string
  kind: 'highlight' | 'search'
  id?: string
  color?: string
  flash: boolean
  left: number
  top: number
  width: number
  height: number
}

export interface ReaderPageProps {
  doc: PDFDocumentProxy
  pageNumber: number
  /** Page size in CSS px at scale 1 (pdf.js viewport at scale 1). */
  baseWidth: number
  baseHeight: number
  scale: number
  renderScale: number
  active: boolean
  highlightMode: boolean
  referenceIndex: ReferenceIndex
  highlights: HighlightRecord[]
  flashHighlightId: string | null
  /** Citation number to flash + reveal on this page, or null. */
  citationFlash: number | null
  /** Submitted search query; hits are marked on this page. */
  searchQuery: string
  /** Changes when the user steps to a search result on this page, which
   * reveals that page's first hit. */
  searchFocusNonce: number | null
}

function isRenderCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'RenderingCancelledException'
}

function viewportOf(el: Element | null): HTMLElement | null {
  return (el?.closest('[data-reader-viewport]') as HTMLElement | null) ?? null
}

export function ReaderPage({
  doc,
  pageNumber,
  baseWidth,
  baseHeight,
  scale,
  renderScale,
  active,
  highlightMode,
  referenceIndex,
  highlights,
  flashHighlightId,
  citationFlash,
  searchQuery,
  searchFocusNonce,
}: ReaderPageProps): JSX.Element {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // Bumped once the text layer's DOM exists for this mount; anchor-based
  // effects (overlays, citation markers, flashes) key off it.
  const [textVersion, setTextVersion] = useState(0)
  const [overlays, setOverlays] = useState<OverlayBox[]>([])

  // Canvas: rasterise at `renderScale` x devicePixelRatio into a fresh
  // canvas, then swap it in, so the old raster stays visible (stretched)
  // until the new one is ready. Superseded renders are cancelled.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let task: RenderTask | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale: renderScale })
        const outputScale = canvasOutputScale(viewport.width, viewport.height, window.devicePixelRatio)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
        canvas.className = styles.canvas
        const ctx = canvas.getContext('2d')
        // jsdom (unit tests) has no 2d context; real Chromium always does.
        if (ctx) {
          task = page.render({
            canvasContext: ctx,
            canvas,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          })
          await task.promise
        }
        if (cancelled) return
        canvasHostRef.current?.replaceChildren(canvas)
      } catch (err: unknown) {
        if (!cancelled && !isRenderCancelled(err)) console.error(`[Reader] Failed to render page ${pageNumber}:`, err)
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, renderScale, active])

  // Text layer: built once per mount at scale 1. pdf.js positions spans in
  // percentages and sizes fonts from `--total-scale-factor`, so zoom only
  // changes the CSS variable on the slot.
  useEffect(() => {
    if (!active) return
    const container = textLayerRef.current
    if (!container) return
    let cancelled = false
    let textLayer: TextLayer | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const textContent = await page.getTextContent()
        if (cancelled) return
        container.replaceChildren()
        textLayer = new TextLayer({
          textContentSource: textContent,
          container,
          viewport: page.getViewport({ scale: 1 }),
        })
        await textLayer.render()
        if (cancelled) return
        setTextVersion((v) => v + 1)
      } catch (err: unknown) {
        if (!cancelled) console.error(`[Reader] Failed to build text layer for page ${pageNumber}:`, err)
      }
    })()

    return () => {
      cancelled = true
      textLayer?.cancel()
      setTextVersion(0)
    }
  }, [doc, pageNumber, active])

  // [P2-03] Wrap resolved `[n]` markers once the text layer exists, and again
  // if the reference index arrives later (injection is idempotent).
  useEffect(() => {
    const container = textLayerRef.current
    if (!container || textVersion === 0) return
    injectCitationMarkers(container, referenceIndex)
  }, [referenceIndex, textVersion])

  // Highlight + search-hit overlay boxes, stored as page fractions.
  useLayoutEffect(() => {
    const container = textLayerRef.current
    if (!container || textVersion === 0) {
      setOverlays([])
      return
    }
    const layerRect = container.getBoundingClientRect()
    const toBox = (rect: DOMRect, base: Omit<OverlayBox, 'left' | 'top' | 'width' | 'height'>): OverlayBox => ({
      ...base,
      left: layerRect.width > 0 ? (rect.left - layerRect.left) / layerRect.width : 0,
      top: layerRect.height > 0 ? (rect.top - layerRect.top) / layerRect.height : 0,
      width: layerRect.width > 0 ? rect.width / layerRect.width : 0,
      height: layerRect.height > 0 ? rect.height / layerRect.height : 0,
    })

    const next: OverlayBox[] = []
    for (const highlight of highlights) {
      let anchor: HighlightAnchor
      try {
        anchor = JSON.parse(highlight.anchor) as HighlightAnchor
      } catch {
        continue
      }
      const range = rangeFromAnchor(container, anchor)
      if (!range) continue
      Array.from(range.getClientRects()).forEach((rect, i) => {
        next.push(
          toBox(rect, {
            key: `h-${highlight.id}-${i}`,
            kind: 'highlight',
            id: highlight.id,
            color: highlight.color,
            flash: highlight.id === flashHighlightId,
          }),
        )
      })
    }
    findTextMatches(container, searchQuery).forEach((anchor, m) => {
      const range = rangeFromAnchor(container, anchor)
      if (!range) return
      Array.from(range.getClientRects()).forEach((rect, i) => {
        next.push(toBox(rect, { key: `s-${m}-${i}`, kind: 'search', flash: false }))
      })
    })
    setOverlays(next)
  }, [highlights, flashHighlightId, searchQuery, textVersion])

  // Reveal the flashing highlight once its overlay exists.
  const revealedFlashRef = useRef<string | null>(null)
  useEffect(() => {
    if (!flashHighlightId) {
      revealedFlashRef.current = null
      return
    }
    if (revealedFlashRef.current === flashHighlightId) return
    const el = Array.from(overlayRef.current?.querySelectorAll<HTMLElement>('[data-highlight-id]') ?? []).find(
      (node) => node.dataset.highlightId === flashHighlightId,
    )
    const viewport = viewportOf(overlayRef.current)
    if (!el || !viewport) return
    revealedFlashRef.current = flashHighlightId
    revealInViewport(viewport, el)
  }, [flashHighlightId, overlays])

  // Reveal the first search hit on this page when the user steps to it
  // (once per step, even if overlays recompute afterwards).
  const revealedSearchRef = useRef<number | null>(null)
  useEffect(() => {
    if (searchFocusNonce === null || revealedSearchRef.current === searchFocusNonce) return
    const el = overlayRef.current?.querySelector('[data-search-hit]')
    const viewport = viewportOf(overlayRef.current)
    if (!el || !viewport) return
    revealedSearchRef.current = searchFocusNonce
    revealInViewport(viewport, el)
  }, [searchFocusNonce, overlays])

  // [P2-03] Flash + reveal the cited reference's marker on this page.
  useEffect(() => {
    if (citationFlash === null) return
    const container = textLayerRef.current
    if (!container || textVersion === 0) return
    const marker = container.querySelector(`[data-citation-number="${citationFlash}"]`)
    if (!marker) return
    marker.classList.add(styles.citationMarkerFlash)
    const viewport = viewportOf(container)
    if (viewport) revealInViewport(viewport, marker)
    return () => marker.classList.remove(styles.citationMarkerFlash)
  }, [citationFlash, textVersion])

  // Width/height use the same CSS expression pdf.js uses for the text layer
  // (setLayerDimensions), so canvas, text layer and overlays share one box.
  const slotStyle = {
    '--total-scale-factor': String(scale),
    width: `round(down, var(--total-scale-factor) * ${baseWidth}px, var(--scale-round-x, 1px))`,
    height: `round(down, var(--total-scale-factor) * ${baseHeight}px, var(--scale-round-y, 1px))`,
  } as CSSProperties

  return (
    <div
      className={styles.pageSlot}
      style={slotStyle}
      data-page-slot=""
      data-page-number={pageNumber}
      aria-label={`Page ${pageNumber}`}
      role="region"
    >
      {active ? (
        <>
          <div ref={canvasHostRef} className={styles.canvasHost} />
          <div
            ref={textLayerRef}
            className={styles.textLayer}
            data-text-layer=""
            data-highlight-mode={highlightMode ? 'active' : undefined}
          />
          <div ref={overlayRef} className={styles.highlightOverlay} data-highlight-overlay="" aria-hidden="true">
            {overlays.map((box) => (
              <div
                key={box.key}
                data-highlight-id={box.kind === 'highlight' ? box.id : undefined}
                data-search-hit={box.kind === 'search' ? '' : undefined}
                className={[
                  box.kind === 'search' ? styles.searchHit : styles.highlightRect,
                  box.flash ? styles.highlightRectFlash : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                  background: box.color,
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
