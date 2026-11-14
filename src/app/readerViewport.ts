// Reader scroll/zoom geometry helpers (#198, #199).
//
// The Reader lays every PDF page out in one vertical scroll column and only
// mounts a canvas + text layer for pages near the viewport. These helpers
// keep the geometry decisions (which page is "current", which pages to
// render, how a wheel/keyboard event maps to a zoom, how to keep the point
// under the cursor fixed while zooming) out of the component so they can be
// unit-tested without a layout engine.

/** Vertical extent of one page slot, in scroll-content coordinates. */
export interface PageBox {
  top: number
  height: number
}

/**
 * Page (1-based) that should drive the "N of M" indicator: the page showing
 * the most pixels inside `[scrollTop, scrollTop + clientHeight]`. Ties go to
 * the earlier page so jumping to page N at low zoom (N and N+1 both fully
 * visible) reports N. Returns 1 for an empty document.
 */
export function pickCurrentPage(boxes: PageBox[], scrollTop: number, clientHeight: number): number {
  const viewTop = scrollTop
  const viewBottom = scrollTop + clientHeight
  let best = 0
  let bestVisible = -1
  for (let i = 0; i < boxes.length; i += 1) {
    const { top, height } = boxes[i]
    if (top > viewBottom) break
    const visible = Math.min(top + height, viewBottom) - Math.max(top, viewTop)
    if (visible > bestVisible) {
      best = i
      bestVisible = visible
    }
  }
  return best + 1
}

/**
 * Inclusive 1-based page range whose slots intersect the viewport extended
 * by `overscan` px above and below. Pages in this range get a canvas and a
 * text layer; the rest stay empty, correctly sized placeholders. Always
 * returns at least the page nearest the viewport so something renders.
 */
export function pagesInWindow(
  boxes: PageBox[],
  scrollTop: number,
  clientHeight: number,
  overscan: number,
): { first: number; last: number } {
  if (boxes.length === 0) return { first: 1, last: 0 }
  const lo = scrollTop - overscan
  const hi = scrollTop + clientHeight + overscan
  let first = -1
  let last = -1
  for (let i = 0; i < boxes.length; i += 1) {
    const { top, height } = boxes[i]
    if (top + height >= lo && top <= hi) {
      if (first === -1) first = i
      last = i
    } else if (top > hi) {
      break
    }
  }
  if (first === -1) {
    const nearest = pickCurrentPage(boxes, scrollTop, clientHeight) - 1
    return { first: nearest + 1, last: nearest + 1 }
  }
  return { first: first + 1, last: last + 1 }
}

/** Pixels per line for `WheelEvent.DOM_DELTA_LINE` (Firefox-style mice). */
const LINE_HEIGHT_PX = 16
/** Largest per-event delta honoured, so one notch of a mouse wheel with
 * Ctrl held zooms by a step rather than jumping straight to a bound. */
const MAX_ZOOM_DELTA_PX = 12
/** Exponential zoom rate: scale *= exp(-delta * rate). A trackpad pinch
 * produces many small deltas, giving a smooth, symmetric zoom. */
const ZOOM_RATE = 0.01

/**
 * Multiplicative zoom factor for a Ctrl/Cmd+wheel (trackpad pinch) event.
 * Negative `deltaY` (pinch out / wheel up) zooms in (> 1).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * 800 : deltaY
  const clamped = Math.max(-MAX_ZOOM_DELTA_PX, Math.min(MAX_ZOOM_DELTA_PX, px))
  return Math.exp(-clamped * ZOOM_RATE)
}

export type ZoomKeyAction = 'in' | 'out' | 'reset'

/**
 * Maps a keydown to a reader zoom action: Ctrl/Cmd with `=`/`+`, `-`/`_`,
 * or `0`. Returns null for anything else (including Alt-modified keys, so
 * OS/keyboard-layout shortcuts aren't swallowed).
 */
export function zoomKeyAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): ZoomKeyAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  switch (event.key) {
    case '=':
    case '+':
      return 'in'
    case '-':
    case '_':
      return 'out'
    case '0':
      return 'reset'
    default:
      return null
  }
}

/**
 * Where a zoom should keep content fixed: a page slot, the fractional point
 * inside it, and the client-space point it must stay under.
 */
export interface ZoomAnchor {
  page: number
  fx: number
  fy: number
  clientX: number
  clientY: number
}

const SLOT_SELECTOR = '[data-page-slot]'

function slotRects(viewport: HTMLElement): Array<{ page: number; rect: DOMRect }> {
  return Array.from(viewport.querySelectorAll<HTMLElement>(SLOT_SELECTOR)).map((el) => ({
    page: Number(el.dataset.pageNumber),
    rect: el.getBoundingClientRect(),
  }))
}

/**
 * Record the page-relative position currently under `(clientX, clientY)`.
 * Points between pages or beside a page resolve to the nearest page, with
 * fractions outside 0..1 — still a stable anchor after re-layout.
 */
export function captureZoomAnchor(viewport: HTMLElement, clientX: number, clientY: number): ZoomAnchor | null {
  const slots = slotRects(viewport)
  if (slots.length === 0) return null
  let chosen = slots[0]
  let bestDistance = Infinity
  for (const slot of slots) {
    const { top, bottom } = slot.rect
    const distance = clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0
    if (distance < bestDistance) {
      bestDistance = distance
      chosen = slot
      if (distance === 0) break
    }
  }
  const { rect } = chosen
  return {
    page: chosen.page,
    fx: rect.width > 0 ? (clientX - rect.left) / rect.width : 0,
    fy: rect.height > 0 ? (clientY - rect.top) / rect.height : 0,
    clientX,
    clientY,
  }
}

/** Adjust `viewport`'s scroll so the anchored page point is back under its
 * client point after the page slots were resized. */
export function restoreZoomAnchor(viewport: HTMLElement, anchor: ZoomAnchor): void {
  const slot = viewport.querySelector<HTMLElement>(`${SLOT_SELECTOR}[data-page-number="${anchor.page}"]`)
  if (!slot) return
  const rect = slot.getBoundingClientRect()
  const dx = rect.left + anchor.fx * rect.width - anchor.clientX
  const dy = rect.top + anchor.fy * rect.height - anchor.clientY
  viewport.scrollLeft += dx
  viewport.scrollTop += dy
}

/** Largest canvas backing store (in device pixels) a single page may use.
 * Bounds memory at high zoom on HiDPI screens (a 300% US-Letter page at
 * DPR 2 would otherwise need ~17M px, ~70MB). */
export const MAX_CANVAS_PIXELS = 16_777_216

/** Device-pixel multiplier for a page canvas of `cssWidth` x `cssHeight`:
 * `devicePixelRatio`, reduced if needed to stay under `MAX_CANVAS_PIXELS`. */
export function canvasOutputScale(cssWidth: number, cssHeight: number, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const area = cssWidth * cssHeight
  if (area <= 0) return dpr
  const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / area)
  return Math.min(dpr, maxScale)
}

/**
 * Scroll `viewport` (only — never its ancestors, unlike
 * `Element.scrollIntoView`) so `target` is visible: vertically centred when
 * it is outside the view, horizontally nudged just enough to show it.
 */
export function revealInViewport(viewport: HTMLElement, target: Element): void {
  const view = viewport.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  if (rect.top < view.top || rect.bottom > view.bottom) {
    viewport.scrollTop += rect.top + rect.height / 2 - (view.top + viewport.clientHeight / 2)
  }
  if (rect.left < view.left) {
    viewport.scrollLeft += rect.left - view.left - 16
  } else if (rect.right > view.left + viewport.clientWidth) {
    viewport.scrollLeft += rect.right - (view.left + viewport.clientWidth) + 16
  }
}

/** Next zoom step from `scale` in direction `dir`, snapping a free-form
 * (pinch) scale onto the `step` grid so buttons/keys land on round values. */
export function steppedScale(scale: number, step: number, dir: 1 | -1): number {
  const index = scale / step
  const snapped = dir > 0 ? Math.floor(index + 1e-6) + 1 : Math.ceil(index - 1e-6) - 1
  return snapped * step
}
