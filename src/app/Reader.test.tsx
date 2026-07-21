// @vitest-environment jsdom
//
// pdf.js can't meaningfully render (no real canvas 2D context, no worker
// thread) under jsdom, so `pdfjs-dist` is mocked wholesale here. These tests
// cover the component's own logic — page nav, zoom, TOC, search state, and
// the empty/error states — not pdf.js's rendering pipeline. Visual rendering
// (canvas raster + selectable text layer) is verified manually: `npm run dev`
// with a real `data/papers/<slug>/paper.pdf` on disk.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampPage, clampScale, countOccurrences, Reader } from './Reader'

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

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    render(): Promise<void> {
      return Promise.resolve()
    }
  },
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'worker-url' }))

beforeEach(() => {
  getDocumentMock.mockReset()
  getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakePdfDoc()) })
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      ping: vi.fn().mockResolvedValue('pong'),
      readPaperFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
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
