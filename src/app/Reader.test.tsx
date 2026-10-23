// @vitest-environment jsdom
//
// pdf.js can't meaningfully render (no real canvas 2D context, no worker
// thread) under jsdom, so `pdfjs-dist` is mocked wholesale here. These tests
// cover the component's own logic — page nav, zoom, TOC, search state, and
// the empty/error states — not pdf.js's rendering pipeline. Real Electron
// geometry/raster and pointer selection: test/reader-alignment-live.mjs.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  anchorFromRange,
  buildReferenceIndex,
  clampPage,
  clampScale,
  countOccurrences,
  expandCitationNumbers,
  injectCitationMarkers,
  rangeFromAnchor,
  Reader,
  type ReferenceIndex,
} from './Reader'
import { AbortException, RenderingCancelledException } from 'pdfjs-dist/legacy/build/pdf.mjs'

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
const textLayerRenderMock = vi.fn()
const textLayerCancelMock = vi.fn()

// TextLayer's mock actually appends one <span> per text item into the given
// container on render() (unlike a true no-op) — [P2-02]'s highlight-capture
// tests need real DOM text nodes inside the text layer to build a Selection/
// Range against, the same way pdf.js's real TextLayer would populate it.
// Page-nav/zoom/search/TOC tests above don't touch this DOM at all, so
// making the mock slightly more realistic doesn't affect them.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  RenderingCancelledException: class extends Error {},
  AbortException: class extends Error {},
  TextLayer: class {
    private readonly container: HTMLElement
    private readonly items: Array<{ str: string }>

    constructor(opts: { textContentSource: { items: Array<{ str: string }> }; container: HTMLElement }) {
      this.container = opts.container
      this.items = opts.textContentSource.items
    }

    render(): Promise<void> {
      const pending = textLayerRenderMock(this.container)
      if (pending) return pending
      for (const item of this.items) {
        const span = document.createElement('span')
        span.textContent = item.str
        this.container.appendChild(span)
      }
      return Promise.resolve()
    }

    cancel(): void { textLayerCancelMock(this.container) }
  },
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: 'worker-url' }))

beforeEach(() => {
  textLayerRenderMock.mockReset()
  textLayerCancelMock.mockReset()
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
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('Reader superseded rendering', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  it('releases the canvas before zoom/navigation reuses it and leaves final text selectable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const tasks: Array<ReturnType<typeof deferred<void>> & { cancel: () => void }> = []
    let canvasBusy = false
    let overlaps = 0
    getDocumentMock.mockReturnValue({ promise: Promise.resolve({
      numPages: 2,
      getOutline: async () => null,
      getPage: async (page: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale, scale, userUnit: 1 }),
        getTextContent: async () => ({ items: [{ str: PAGE_TEXT[page - 1] }] }),
        render: () => {
          if (canvasBusy) overlaps += 1
          canvasBusy = true
          const pending = deferred<void>()
          const task = { ...pending, cancel: () => {
            canvasBusy = false
            pending.reject(new RenderingCancelledException('Rendering cancelled', 0))
          } }
          tasks.push(task)
          return task
        },
      }),
    }) })
    const onAddToChat = vi.fn()
    const { container, unmount } = render(<Reader slug="my-paper" onAddToChat={onAddToChat} />)
    await waitFor(() => expect(tasks).toHaveLength(1))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '›' })) })
    expect(tasks).toHaveLength(3)
    expect(overlaps).toBe(0)
    await act(async () => { canvasBusy = false; tasks[2].resolve() })
    const textLayer = getTextLayer(container)
    await waitFor(() => expect(textLayer).toHaveTextContent(PAGE_TEXT[1]))
    expect(container.querySelector('canvas')).toHaveAttribute('width', '125')
    const range = document.createRange()
    const textNode = textLayer.querySelector('span')!.firstChild!
    range.setStart(textNode, 0)
    range.setEnd(textNode, PAGE_TEXT[1].length)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    fireEvent.mouseUp(textLayer)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to chat' }))
    expect(onAddToChat).toHaveBeenCalledWith(PAGE_TEXT[1], 2)
    unmount()
  })

  it('cancels pending text writes before navigation and unmount without reporting expected cancellation', async () => {
    const first = deferred<void>()
    const last = deferred<void>()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    textLayerRenderMock.mockReturnValueOnce(first.promise)
    textLayerCancelMock.mockImplementationOnce(() => first.reject(new AbortException('TextLayer task cancelled.')))
    const { container, unmount } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(textLayerRenderMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '›' }))
    await waitFor(() => expect(getTextLayer(container)).toHaveTextContent(PAGE_TEXT[1]))
    expect(textLayerCancelMock).toHaveBeenCalledTimes(1)
    textLayerRenderMock.mockReturnValueOnce(last.promise)
    textLayerCancelMock.mockImplementationOnce(() => last.reject(new AbortException('TextLayer task cancelled.')))
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    await waitFor(() => expect(textLayerRenderMock).toHaveBeenCalledTimes(3))
    await act(async () => unmount())
    expect(textLayerCancelMock).toHaveBeenCalledTimes(2)
    expect(errors).not.toHaveBeenCalled()
  })

  it('does not cancel a completed canvas task while cancelling its pending text layer', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const cancelCanvas = vi.fn()
    const pendingText = deferred<void>()
    textLayerRenderMock.mockReturnValueOnce(pendingText.promise)
    textLayerCancelMock.mockImplementationOnce(() => pendingText.reject(new AbortException('TextLayer task cancelled.')))
    getDocumentMock.mockReturnValue({ promise: Promise.resolve({
      numPages: 1,
      getOutline: async () => null,
      getPage: async () => ({ ...fakePage(PAGE_TEXT[0]), render: () => ({ promise: Promise.resolve(), cancel: cancelCanvas }) }),
    }) })
    const { unmount } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(textLayerRenderMock).toHaveBeenCalledTimes(1))
    await act(async () => unmount())
    expect(cancelCanvas).not.toHaveBeenCalled()
    expect(textLayerCancelMock).toHaveBeenCalledTimes(1)
  })

  it.each(['canvas', 'text'] as const)('shows an actionable %s failure and recovers on a new zoom', async (stage) => {
    const failure = new Error('PDF drawing failed')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    if (stage === 'text') {
      textLayerRenderMock.mockRejectedValueOnce(failure)
    } else {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
      const draw = vi.fn()
        .mockImplementationOnce(() => ({ promise: Promise.reject(failure), cancel: vi.fn() }))
        .mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
      getDocumentMock.mockReturnValue({ promise: Promise.resolve({
        numPages: 2,
        getOutline: async () => null,
        getPage: async () => ({ ...fakePage(PAGE_TEXT[0]), render: draw }),
      }) })
    }
    const { container } = render(<Reader slug="my-paper" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not render page 1: PDF drawing failed. Try another page or zoom level.')
    expect(container.querySelector('canvas')!.parentElement).not.toBeVisible()
    expect(errors).toHaveBeenCalledWith('[Reader] Failed to render page 1:', failure)
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    await waitFor(() => expect(getTextLayer(container)).toHaveTextContent(PAGE_TEXT[0]))
    expect(container.querySelector('canvas')).toBeVisible()
  })

  it('reports a genuine failure already settled when cleanup runs without replacing current page state', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending = deferred<void>()
    const failure = new Error('Raster failure before navigation')
    const draw = vi.fn()
      .mockReturnValueOnce({ promise: pending.promise, cancel: vi.fn() })
      .mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
    getDocumentMock.mockReturnValue({ promise: Promise.resolve({
      numPages: 2,
      getOutline: async () => null,
      getPage: async (page: number) => ({ ...fakePage(PAGE_TEXT[page - 1]), render: draw }),
    }) })
    const { container } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1))
    await act(async () => {
      pending.reject(failure)
      fireEvent.click(screen.getByRole('button', { name: '›' }))
    })
    await waitFor(() => expect(getTextLayer(container)).toHaveTextContent(PAGE_TEXT[1]))
    expect(errors).toHaveBeenCalledWith('[Reader] Failed to render page 1:', failure)
    expect(screen.queryByRole('alert')).toBeNull()
  })
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

describe('expandCitationNumbers [P2-03]', () => {
  it('expands a single number', () => {
    expect(expandCitationNumbers('4')).toEqual([4])
  })

  it('expands a comma-separated list', () => {
    expect(expandCitationNumbers('1, 2, 3')).toEqual([1, 2, 3])
  })

  it('expands a dash range', () => {
    expect(expandCitationNumbers('3-5')).toEqual([3, 4, 5])
  })

  it('expands a mix of bare numbers and ranges', () => {
    expect(expandCitationNumbers('1, 3-5, 7')).toEqual([1, 3, 4, 5, 7])
  })

  it('drops malformed fragments rather than throwing', () => {
    expect(expandCitationNumbers('1, x, 2')).toEqual([1, 2])
  })

  it('drops an oversized range instead of allocating it (garbled-PDF guard)', () => {
    expect(expandCitationNumbers('1-999999999')).toEqual([])
  })

  it('still expands other well-formed fragments alongside a dropped oversized range', () => {
    expect(expandCitationNumbers('1, 1-999999999, 2')).toEqual([1, 2])
  })

  it('expands a range right at the cap boundary', () => {
    expect(expandCitationNumbers('1-101')).toHaveLength(101)
  })
})

describe('buildReferenceIndex [P2-03]', () => {
  it('maps reference numbers to the page they appear on with their citation text', () => {
    const pages = [
      ['This paper cites [1] and [2].'],
      ['References'],
      ['[1] Smith, J. Title A.', '[2] Doe, J. Title B.'],
    ]

    const index = buildReferenceIndex(pages)

    expect(index.get(1)).toEqual({ number: 1, page: 3, text: 'Smith, J. Title A.' })
    expect(index.get(2)).toEqual({ number: 2, page: 3, text: 'Doe, J. Title B.' })
  })

  it('finds a reference list sharing a page with its heading', () => {
    const pages = [['Intro text.'], ['References', '[1] Smith, J. Title A.']]

    const index = buildReferenceIndex(pages)

    expect(index.get(1)).toEqual({ number: 1, page: 2, text: 'Smith, J. Title A.' })
  })

  it('returns an empty index when no references/bibliography heading is found', () => {
    const pages = [['This paper cites [1] but has no reference list.']]

    expect(buildReferenceIndex(pages).size).toBe(0)
  })
})

describe('injectCitationMarkers [P2-03]', () => {
  function buildContainer(text: string): HTMLDivElement {
    const container = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = text
    container.appendChild(span)
    document.body.appendChild(container)
    return container
  }

  it('wraps a resolved [n] marker in a clickable button carrying its number', () => {
    const container = buildContainer('Supported by prior work [1].')
    const index: ReferenceIndex = new Map([[1, { number: 1, page: 3, text: 'Smith, J.' }]])

    injectCitationMarkers(container, index)

    const button = container.querySelector('button[data-citation-number="1"]')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('[1]')
    expect(container.textContent).toBe('Supported by prior work [1].')
  })

  it('leaves an unresolved [n] marker as plain text', () => {
    const container = buildContainer('Cites [9] which has no reference entry.')
    const index: ReferenceIndex = new Map([[1, { number: 1, page: 3, text: 'Smith, J.' }]])

    injectCitationMarkers(container, index)

    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('Cites [9] which has no reference entry.')
  })

  it('does nothing when the reference index is empty (no references section found)', () => {
    const container = buildContainer('Cites [1] before any index is built.')

    injectCitationMarkers(container, new Map())

    expect(container.querySelector('button')).toBeNull()
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

// Fake docs used by the [P2-03] inline citation click-through tests below —
// distinct from `fakePdfDoc`/`PAGE_TEXT` above (which have no `[n]` markers
// at all), so these override `getDocumentMock`'s return per-test.
function citationPdfDoc(): unknown {
  const pages = ['This claim is supported by prior work [1].', 'References\n[1] Author, A. Some Paper Title.']
  return {
    numPages: 2,
    getPage: (pageNumber: number) =>
      Promise.resolve({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: () => Promise.resolve({ items: [{ str: pages[pageNumber - 1] ?? '' }] }),
      }),
    getOutline: () => Promise.resolve(null),
  }
}

function noReferencesPdfDoc(): unknown {
  const text = 'This claim cites [1] but there is no bibliography in this document.'
  return {
    numPages: 1,
    getPage: () =>
      Promise.resolve({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: () => Promise.resolve({ items: [{ str: text }] }),
      }),
    getOutline: () => Promise.resolve(null),
  }
}

async function findCitationMarker(container: HTMLElement, number: number): Promise<HTMLElement> {
  const textLayer = getTextLayer(container)
  return waitFor(() => {
    const el = textLayer.querySelector(`[data-citation-number="${number}"]`)
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
}

describe('Reader inline citation click-through [P2-03]', () => {
  it('renders a resolved [n] marker as a clickable button and jumps to its reference page on click', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(citationPdfDoc()) })
    const user = userEvent.setup()

    const { container } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    const marker = await findCitationMarker(container, 1)
    expect(marker.tagName).toBe('BUTTON')

    await user.click(marker)

    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('2 of 2'))
  })

  it('shows the reference text in a tooltip on hover', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(citationPdfDoc()) })

    const { container } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    const marker = await findCitationMarker(container, 1)

    fireEvent.mouseOver(marker)

    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(/Author, A\. Some Paper Title\./))
  })

  it('leaves [n] markers as plain text when no references section is found (feature stays inert, no crash)', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(noReferencesPdfDoc()) })

    const { container } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 1'))

    const textLayer = getTextLayer(container)
    await waitFor(() => expect(textLayer.textContent).toContain('[1]'))
    expect(textLayer.querySelector('button[data-citation-number]')).toBeNull()
  })
})

describe('Reader highlight overlay + citation marker interaction [P2-02 x P2-03]', () => {
  it('still resolves the highlight overlay rect after injectCitationMarkers splits the page text nodes', async () => {
    // Page 1 text: "This claim is supported by prior work [1]." — a highlight
    // anchored over "claim" (offsets 5..10) shares this page with a `[1]`
    // citation marker that resolves against page 2's references. Regression
    // for the highest-risk P2-02 x P2-03 interaction: `injectCitationMarkers`
    // replaces the page's single text node with several (plain-text +
    // button) nodes — `rangeFromAnchor`'s character-offset walk over the
    // container's text nodes must still land on the same characters
    // afterwards, since total text content is unchanged, just re-split.
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(citationPdfDoc()) })
    const highlight = {
      id: 'h1',
      paperSlug: 'my-paper',
      page: 1,
      color: 'yellow',
      quote: 'claim',
      anchor: JSON.stringify({ start: 5, end: 10 }),
      createdAt: 't',
    }
    window.vellum.highlightsList = vi.fn().mockResolvedValue([highlight])

    const { container } = render(<Reader slug="my-paper" />)
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    // Confirms the citation marker actually got injected (splitting the
    // text node) before asserting the highlight overlay still resolves.
    await findCitationMarker(container, 1)

    const textLayer = getTextLayer(container)
    expect(textLayer.textContent).toBe('This claim is supported by prior work [1].')

    const overlayContainer = getOverlayContainer(container)
    await waitFor(() => expect(overlayContainer.children.length).toBe(1))

    const rect = overlayContainer.firstElementChild as HTMLElement
    expect(rect.style.background).toBe('yellow')
  })
})

describe('Reader selection actions [R1-05]', () => {
  it.each([
    { action: 'Add to chat', page: 1, quote: 'Introduction' },
    { action: 'Explain', page: 2, quote: 'Vellum reads' },
  ])('preserves selected text and page for $action after navigation/zoom', async ({ action, page, quote }) => {
    const onAddToChat = vi.fn()
    const onExplain = vi.fn()
    const { container } = render(
      <Reader slug="my-paper" onAddToChat={onAddToChat} onExplain={onExplain} />,
    )
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveTextContent('1 of 2'))

    if (page === 2) {
      fireEvent.click(screen.getByText('+', { selector: 'button' }))
      fireEvent.click(screen.getByText('›', { selector: 'button' }))
      await waitFor(() => expect(getTextLayer(container).textContent).toBe(PAGE_TEXT[1]))
    }

    const textLayer = getTextLayer(container)
    await waitFor(() => expect(textLayer.querySelector('span')).not.toBeNull())

    const textNode = textLayer.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, quote.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent.mouseUp(textLayer)

    // Selection menu toolbar should appear
    fireEvent.click(await screen.findByRole('button', { name: action }))
    expect(action === 'Add to chat' ? onAddToChat : onExplain).toHaveBeenCalledWith(quote, page)
  })
})
