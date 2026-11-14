// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  MAX_CANVAS_PIXELS,
  canvasOutputScale,
  captureZoomAnchor,
  pagesInWindow,
  pickCurrentPage,
  restoreZoomAnchor,
  revealInViewport,
  steppedScale,
  wheelZoomFactor,
  zoomKeyAction,
  type PageBox,
} from './readerViewport'

// Ten 1000px pages with 10px gaps, starting 16px down (top padding).
const BOXES: PageBox[] = Array.from({ length: 10 }, (_, i) => ({ top: 16 + i * 1010, height: 1000 }))

describe('pickCurrentPage', () => {
  it('is page 1 at the top of the document', () => {
    expect(pickCurrentPage(BOXES, 0, 800)).toBe(1)
  })

  it('tracks the page showing the most pixels while scrolling', () => {
    // View 1300..2100: page 2 (1026..2026) shows 726px, page 3 (2036..) 64px.
    // View 1800..2600: page 2 shows 226px, page 3 shows 564px.
    expect(pickCurrentPage(BOXES, 1300, 800)).toBe(2)
    expect(pickCurrentPage(BOXES, 1800, 800)).toBe(3)
  })

  it('prefers the earlier page on a tie (both fully visible at low zoom)', () => {
    const small: PageBox[] = Array.from({ length: 5 }, (_, i) => ({ top: 16 + i * 310, height: 300 }))
    // Viewport shows pages 3 and 4 fully.
    expect(pickCurrentPage(small, 636, 700)).toBe(3)
  })

  it('reaches the last page at the bottom', () => {
    expect(pickCurrentPage(BOXES, 9 * 1010 + 16 + 200, 800)).toBe(10)
  })

  it('returns 1 for an empty document', () => {
    expect(pickCurrentPage([], 0, 800)).toBe(1)
  })
})

describe('pagesInWindow', () => {
  it('covers the visible pages plus overscan', () => {
    expect(pagesInWindow(BOXES, 0, 800, 0)).toEqual({ first: 1, last: 1 })
    expect(pagesInWindow(BOXES, 0, 800, 800)).toEqual({ first: 1, last: 2 })
    // Window 2200..4600 touches pages 3 (2036..3036) through 5 (4056..5056).
    expect(pagesInWindow(BOXES, 3000, 800, 800)).toEqual({ first: 3, last: 5 })
  })

  it('never renders the whole document for a long paper', () => {
    const many: PageBox[] = Array.from({ length: 200 }, (_, i) => ({ top: 16 + i * 1010, height: 1000 }))
    const { first, last } = pagesInWindow(many, 50_000, 800, 800)
    expect(last - first).toBeLessThanOrEqual(3)
  })

  it('returns an empty range for no pages', () => {
    expect(pagesInWindow([], 0, 800, 800)).toEqual({ first: 1, last: 0 })
  })
})

describe('wheelZoomFactor', () => {
  it('zooms in for negative deltaY and out for positive', () => {
    expect(wheelZoomFactor(-5, 0)).toBeGreaterThan(1)
    expect(wheelZoomFactor(5, 0)).toBeLessThan(1)
  })

  it('is symmetric so pinch out then in returns to the start', () => {
    expect(wheelZoomFactor(-7, 0) * wheelZoomFactor(7, 0)).toBeCloseTo(1, 10)
  })

  it('caps one mouse-wheel notch to a modest step', () => {
    const notch = wheelZoomFactor(-100, 0)
    // About 13% per notch: five notches take 100% to ~180%, not to the cap.
    expect(notch).toBeGreaterThan(1.1)
    expect(notch).toBeLessThan(1.15)
    expect(wheelZoomFactor(-3, 1)).toBe(wheelZoomFactor(-48, 0))
  })
})

describe('zoomKeyAction', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  })

  it('maps Ctrl/Cmd + = + - _ 0', () => {
    expect(zoomKeyAction(key('=', { ctrlKey: true }))).toBe('in')
    expect(zoomKeyAction(key('+', { metaKey: true }))).toBe('in')
    expect(zoomKeyAction(key('-', { ctrlKey: true }))).toBe('out')
    expect(zoomKeyAction(key('_', { metaKey: true }))).toBe('out')
    expect(zoomKeyAction(key('0', { ctrlKey: true }))).toBe('reset')
  })

  it('ignores unmodified, Alt-modified and unrelated keys', () => {
    expect(zoomKeyAction(key('='))).toBeNull()
    expect(zoomKeyAction(key('=', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(zoomKeyAction(key('a', { ctrlKey: true }))).toBeNull()
  })
})

describe('canvasOutputScale', () => {
  it('uses devicePixelRatio for normal sizes', () => {
    expect(canvasOutputScale(612, 792, 2)).toBe(2)
    expect(canvasOutputScale(612, 792, 1)).toBe(1)
  })

  it('caps the backing store at MAX_CANVAS_PIXELS', () => {
    const w = 612 * 3
    const h = 792 * 3
    const s = canvasOutputScale(w, h, 2)
    expect(s).toBeLessThan(2)
    expect(w * s * h * s).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1)
  })

  it('falls back to 1 for a bogus ratio', () => {
    expect(canvasOutputScale(100, 100, 0)).toBe(1)
    expect(canvasOutputScale(100, 100, Number.NaN)).toBe(1)
  })
})

describe('captureZoomAnchor / restoreZoomAnchor', () => {
  function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
  }

  function setup(): { viewport: HTMLElement; slots: HTMLElement[] } {
    const viewport = document.createElement('div')
    const slots = [1, 2].map((n) => {
      const el = document.createElement('div')
      el.dataset.pageSlot = ''
      el.dataset.pageNumber = String(n)
      viewport.appendChild(el)
      return el
    })
    return { viewport, slots }
  }

  it('records the page and fractional position under the cursor', () => {
    const { viewport, slots } = setup()
    slots[0].getBoundingClientRect = () => rect(100, -500, 600, 800)
    slots[1].getBoundingClientRect = () => rect(100, 310, 600, 800)
    const anchor = captureZoomAnchor(viewport, 400, 710)
    expect(anchor).toEqual({ page: 2, fx: 0.5, fy: 0.5, clientX: 400, clientY: 710 })
  })

  it('scrolls so the anchored point returns under the cursor after the slot grows', () => {
    const { viewport, slots } = setup()
    slots[1].getBoundingClientRect = () => rect(100, 310, 600, 800)
    const anchor = captureZoomAnchor(viewport, 400, 710)!
    // After doubling the zoom, slot 2 is twice as large and further down.
    slots[1].getBoundingClientRect = () => rect(-200, 620, 1200, 1600)
    let left = 0
    let top = 0
    Object.defineProperty(viewport, 'scrollLeft', { get: () => left, set: (v: number) => (left = v) })
    Object.defineProperty(viewport, 'scrollTop', { get: () => top, set: (v: number) => (top = v) })
    restoreZoomAnchor(viewport, anchor)
    // Point now at x = -200 + 0.5*1200 = 400 (no change), y = 620 + 800 = 1420 -> scroll 710.
    expect(left).toBe(0)
    expect(top).toBe(710)
  })

  it('returns null when there are no page slots', () => {
    expect(captureZoomAnchor(document.createElement('div'), 0, 0)).toBeNull()
  })
})

describe('steppedScale', () => {
  it('steps on the grid from a round value', () => {
    expect(steppedScale(1, 0.25, 1)).toBe(1.25)
    expect(steppedScale(1, 0.25, -1)).toBe(0.75)
  })

  it('snaps a pinch scale to the next grid value in the requested direction', () => {
    expect(steppedScale(1.13, 0.25, 1)).toBe(1.25)
    expect(steppedScale(1.13, 0.25, -1)).toBe(1)
  })
})

describe('revealInViewport', () => {
  it('centres an off-screen target vertically without touching ancestors', () => {
    const viewport = document.createElement('div')
    const target = document.createElement('span')
    viewport.appendChild(target)
    let top = 100
    Object.defineProperty(viewport, 'scrollTop', { get: () => top, set: (v: number) => (top = v) })
    Object.defineProperty(viewport, 'clientHeight', { value: 400 })
    Object.defineProperty(viewport, 'clientWidth', { value: 600 })
    viewport.getBoundingClientRect = () => ({ left: 0, top: 50, right: 600, bottom: 450, width: 600, height: 400 }) as DOMRect
    target.getBoundingClientRect = () => ({ left: 10, top: 900, right: 60, bottom: 920, width: 50, height: 20 }) as DOMRect
    revealInViewport(viewport, target)
    // Target centre 910 should land at view centre 250: +660.
    expect(top).toBe(760)
  })
})
