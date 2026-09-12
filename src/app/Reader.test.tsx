// @vitest-environment jsdom
//
// pdf.js can't meaningfully render (no real canvas 2D context, no worker
// thread) under jsdom, so `pdfjs-dist` is mocked wholesale here. These tests
// cover the component's own logic — page nav, zoom, TOC, search state, and
// the empty/error states — not pdf.js's rendering pipeline. Visual rendering
// (canvas raster + selectable text layer) is verified manually: `npm run dev`
// with a real `data/papers/<slug>/paper.pdf` on disk.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anchorFromRange, clampPage, clampScale, countOccurrences, rangeFromAnchor, Reader } from './Reader'

interface FakePage {
  getViewport: () => { width: number; height: number }
  render: () => { promise: Promise<void> }
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>
}

function fakePage(text: string): FakePage {
  return {
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve() }),
    getTextContent: () => Promise.resolve({ items: [{ str: text }] }),
  }
}

const PAGE_TEXT = ['Introduction to Vellum', 'Vellum reads PDFs offline']

function fakePdfDoc(): unknown {
  return {
    numPages: 2,
    getPage: (pageNumber: number) => Promise.resolve(fakePage(PAGE_TEXT[pageNumber - 1] ?? '')),
    getOutline: () =>
      Promise.resolve([{ title: 'Section 1', dest: 'sec1', items: [] }]),
    getDestination: (id: string) => Promise.resolve(id === 'sec1' ? [{ num: 5, gen: 0 }] : null),
    getPageIndex: () => Promise.resolve(1), // resolves to page 2 (0-indexed)
  }
}

const getDocumentMock = vi.fn()

// TextLayer's mock actually appends one <span> per text item into the given
// container on render() (unlike a true no-op) — [P2-02]'s highlight-capture
// tests need real DOM text nodes inside the text layer to build a Selection/
// Range against, the same way pdf.js's real TextLayer would populate it.
// Page-nav/zoom/search/TOC tests above don't touch this DOM at all, so
// making the mock slightly more realistic doesn't affect them.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    private readonly container: HTMLElement
    private readonly items: Array<{ str: string }>

    constructor(opts: { textContentSource: { items: Array<{ str: string }> }; container: HTMLElement }) {
      this.container = opts.container
      this.items = opts.textContentSource.items
    }

    render(): Promise<void> {
      for (const item of this.items) {
        const span = document.createElement('span')
        span.textContent = item.str
        this.container.appendChild(span)
      }
      return Promise.resolve()
    }
  },
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'worker-url' }))

beforeEach(() => {
  getDocumentMock.mockReset()
  getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakePdfDoc()) })

  // jsdom implements Element.getBoundingClientRect (zero rect) but doesn't
  // implement Range.prototype.getClientRects at all — Reader's highlight
  // overlay effect calls it to position rects. Stubbed here (test-env
  // limitation, not a Reader.tsx bug: real Chromium implements this
  // natively) so overlay-rendering tests don't crash on a missing DOM API.
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function (): DOMRectList {
      const rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) }
      return [rect] as unknown as DOMRectList
    }
  }

  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      ping: vi.fn().mockResolvedValue('pong'),
      readPaperFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      // [P2-02] Reader loads a paper's highlights alongside its PDF bytes;
      // an empty list keeps these pagination/zoom/search-focused tests from
      // touching overlay rendering at all.
      highlightsList: vi.fn().mockResolvedValue([]),
      highlightsCreate: vi.fn(),
      highlightsDelete: vi.fn(),
    },
  })
})

afterEach(() => {
  cleanup()
})

describe('pure helpers', () => {
  it('clampPage clamps into [1, numPages], and to 1 when there is no doc yet', () => {
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(5, 10)).toBe(5)
    expect(clampPage(99, 10)).toBe(10)
    expect(clampPage(3, 0)).toBe(1)
  })

  it('clampScale clamps into [MIN_SCALE, MAX_SCALE]', () => {
    expect(clampScale(0.1)).toBe(0.5)
    expect(clampScale(1.5)).toBe(1.5)
    expect(clampScale(10)).toBe(3)
  })

  it('countOccurrences counts case-insensitive, non-overlapping hits', () => {
    expect(countOccurrences('Vellum reads PDFs. vellum is local-first.', 'vellum')).toBe(2)
    expect(countOccurrences('nothing here', 'xyz')).toBe(0)
    expect(countOccurrences('anything', '')).toBe(0)
  })
})

describe('anchorFromRange / rangeFromAnchor [P2-02]', () => {
  // Builds a text-layer-shaped container: multiple <span> text nodes, the
  // way pdf.js's TextLayer renders one span per text item.
  function buildContainer(spans: string[]): HTMLDivElement {
    const container = document.createElement('div')
    for (const text of spans) {
      const span = document.createElement('span')
      span.textContent = text
      container.appendChild(span)
    }
    document.body.appendChild(container)
    return container
  }

  it('serializes a single-span selection into character offsets', () => {
    const container = buildContainer(['Vellum reads PDFs offline'])
    const textNode = container.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 7)
    range.setEnd(textNode, 12)

    const anchor = anchorFromRange(container, range)

    expect(anchor).toEqual({ start: 7, end: 12 })
  })

  it('serializes a selection spanning multiple spans into container-relative offsets', () => {
    const container = buildContainer(['Vellum reads', 'PDFs offline'])
    const firstText = container.querySelectorAll('span')[0].firstChild!
    const secondText = container.querySelectorAll('span')[1].firstChild!
    const range = document.createRange()
    range.setStart(firstText, 7) // "reads" starts at offset 7 in span 1
    range.setEnd(secondText, 4) // "PDFs" ends at offset 4 in span 2 (offset 12 + 4 = 16 overall)

    const anchor = anchorFromRange(container, range)

    expect(anchor).toEqual({ start: 7, end: 16 })
  })

  it('returns null for a range whose containers are not inside the container', () => {
    const container = buildContainer(['Vellum'])
    const outside = document.createElement('div')
    outside.textContent = 'not in container'
    document.body.appendChild(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)

    expect(anchorFromRange(container, range)).toBeNull()
  })

  it('rangeFromAnchor reconstructs the same text a Range previously anchored', () => {
    const container = buildContainer(['Vellum reads', 'PDFs offline'])
    const anchor = { start: 7, end: 16 }

    const range = rangeFromAnchor(container, anchor)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('readsPDFs')
  })

  it('rangeFromAnchor returns null when the anchor no longer fits the current text', () => {
    const container = buildContainer(['short'])

    expect(rangeFromAnchor(container, { start: 0, end: 999 })).toBeNull()
  })

  it('round-trips: anchorFromRange then rangeFromAnchor recovers the original selected text', () => {
    const container = buildContainer(['The quick brown fox jumps'])
    const textNode = container.querySelector('span')!.firstChild!
    const original = document.createRange()
    original.setStart(textNode, 4)
    original.setEnd(textNode, 15)
    expect(original.toString()).toBe('quick brown')

    const anchor = anchorFromRange(container, original)!
    const recovered = rangeFromAnchor(container, anchor)!

    expect(recovered.toString()).toBe('quick brown')
  })
})

describe('Reader empty state', () => {
  it('shows the empty state and never touches window.vellum when no slug is open', () => {
    render(<Reader />)

    expect(screen.getByText('No paper open')).toBeInTheDocument()
    expect(screen.getByText(/Open a paper from Library/i)).toBeInTheDocument()
    expect(window.vellum.readPaperFile).not.toHaveBeenCalled()
  })
})

describe('Reader error state', () => {
  it('shows an error instead of crashing when the PDF file is missing', async () => {
    window.vellum.readPaperFile = vi.fn().mockResolvedValue(null)

    render(<Reader slug="missing-paper" />)

    await waitFor(() => expect(screen.getByText(/No PDF found/i)).toBeInTheDocument())
  })
})

describe('Reader with a loaded document', () => {
  it('reads paper bytes via window.vellum only (never fs/node)', async () => {
    render(<Reader slug="my-paper" />)

    await waitFor(() => expect(window.vellum.readPaperFile).toHaveBeenCalledWith('my-paper'))
  })

  it('paginates with page nav, disabling at bounds', async () => {
    const user = userEvent.setup()
    render(<Reader slug="my-paper" />)

    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))
    expect(screen.getByText('‹', { selector: 'button' })).toBeDisabled()

    await user.click(screen.getByText('›', { selector: 'button' }))
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('2 of 2'))
    expect(screen.getByText('›', { selector: 'button' })).toBeDisabled()

    await user.click(screen.getByText('‹', { selector: 'button' }))
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))
  })

  it('zooms in/out within bounds', async () => {
    const user = userEvent.setup()
    render(<Reader slug="my-paper" />)

    await waitFor(() => expect(screen.getByLabelText('Zoom')).toHaveTextContent('100%'))

    await user.click(screen.getByText('+', { selector: 'button' }))
    expect(screen.getByLabelText('Zoom')).toHaveTextContent('125%')

    await user.click(screen.getByText('−', { selector: 'button' }))
    await user.click(screen.getByText('−', { selector: 'button' }))
    expect(screen.getByLabelText('Zoom')).toHaveTextContent('75%')
  })

  it('opens the TOC and navigates to a resolved outline entry', async () => {
    const user = userEvent.setup()
    render(<Reader slug="my-paper" />)

    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    await user.click(screen.getByRole('button', { name: 'Outline' }))
    const outlineEntry = await screen.findByRole('button', { name: 'Section 1' })
    expect(outlineEntry).not.toBeDisabled()

    await user.click(outlineEntry)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('2 of 2'))
  })

  it('searches the document and cycles through page matches', async () => {
    const user = userEvent.setup()
    render(<Reader slug="my-paper" />)

    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    await user.type(screen.getByLabelText('Search in document'), 'vellum')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByLabelText('Search matches')).toHaveTextContent('1 / 2'))
    // First match is on page 1 (both pages contain "vellum" per PAGE_TEXT).
    expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2')

    await user.click(screen.getByRole('button', { name: 'Next match' }))
    await waitFor(() => expect(screen.getByLabelText('Search matches')).toHaveTextContent('2 / 2'))
    expect(screen.getByLabelText('Page')).toHaveTextContent('2 of 2')
  })

  it('shows 0 / 0 for a query with no matches', async () => {
    const user = userEvent.setup()
    render(<Reader slug="my-paper" />)

    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    await user.type(screen.getByLabelText('Search in document'), 'nonexistent-term')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByLabelText('Search matches')).toHaveTextContent('0 / 0'))
  })
})

// Locates the rendered text-layer div: DOM order in Reader.tsx's pageLayer is
// <canvas />, <div (text layer) />, <div (highlight overlay) /> — no
// data-testid is added to production code for this, so tests navigate that
// fixed structural order instead.
function getTextLayer(container: HTMLElement): HTMLElement {
  return container.querySelector('canvas')!.nextElementSibling as HTMLElement
}

function getOverlayContainer(container: HTMLElement): HTMLElement {
  return getTextLayer(container).nextElementSibling as HTMLElement
}

describe('Reader highlight capture [P2-02]', () => {
  it('creates a highlight from a text-layer selection while the highlight tool is active, and renders the returned record as an overlay', async () => {
    const record = {
      id: 'h1',
      paperSlug: 'my-paper',
      page: 1,
      color: 'yellow',
      quote: 'Introduction',
      anchor: JSON.stringify({ start: 0, end: 12 }),
      createdAt: 't',
    }
    window.vellum.highlightsCreate = vi.fn().mockResolvedValue(record)

    const { container } = render(<Reader slug="my-paper" highlightTool={{ active: true, color: 'yellow' }} />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    const textLayer = getTextLayer(container)
    await waitFor(() => expect(textLayer.querySelector('span')).not.toBeNull())

    // PAGE_TEXT[0] is 'Introduction to Vellum' — select "Introduction" (0..12).
    const textNode = textLayer.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 12)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent.mouseUp(textLayer)

    await waitFor(() =>
      expect(window.vellum.highlightsCreate).toHaveBeenCalledWith({
        slug: 'my-paper',
        page: 1,
        color: 'yellow',
        quote: 'Introduction',
        anchor: JSON.stringify({ start: 0, end: 12 }),
      }),
    )

    // The record highlightsCreate resolves with is appended to Reader's
    // highlight state, which the overlay-recompute effect turns into a
    // rendered rect.
    const overlayContainer = getOverlayContainer(container)
    await waitFor(() => expect(overlayContainer.children.length).toBe(1))
  })

  it('does not create a highlight on mouseup when the highlight tool is inactive', async () => {
    const { container } = render(<Reader slug="my-paper" highlightTool={{ active: false, color: 'yellow' }} />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    const textLayer = getTextLayer(container)
    await waitFor(() => expect(textLayer.querySelector('span')).not.toBeNull())

    const textNode = textLayer.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 12)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent.mouseUp(textLayer)

    expect(window.vellum.highlightsCreate).not.toHaveBeenCalled()
  })
})

describe('Reader jump/flash seam [P2-02]', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates to the jump target page, flashes the highlight, then clears the flash after FLASH_DURATION_MS', async () => {
    const highlight = {
      id: 'h1',
      paperSlug: 'my-paper',
      page: 2,
      color: 'yellow',
      quote: 'PDFs',
      anchor: JSON.stringify({ start: 0, end: 4 }),
      createdAt: 't',
    }
    window.vellum.highlightsList = vi.fn().mockResolvedValue([highlight])

    const { container, rerender } = render(<Reader slug="my-paper" jumpTarget={null} />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    rerender(<Reader slug="my-paper" jumpTarget={{ page: 2, highlightId: 'h1', nonce: 1 }} />)

    // Navigated to the jump target's page.
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('2 of 2'))

    const overlayContainer = getOverlayContainer(container)
    await waitFor(() => expect(overlayContainer.children.length).toBe(1))

    // Flash applies a second CSS-module class (`highlightRect` +
    // `highlightRectFlash`) to the overlay rect — checked by class-token
    // count rather than a specific (hashed) class name.
    const rect = overlayContainer.firstElementChild as HTMLElement
    await waitFor(() => expect(rect.className.trim().split(/\s+/)).toHaveLength(2))

    // FLASH_DURATION_MS in Reader.tsx is 1500ms.
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })

    await waitFor(() => expect(rect.className.trim().split(/\s+/)).toHaveLength(1))
  })
})
