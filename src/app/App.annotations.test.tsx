// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HighlightRecord } from '../../core/highlights/repo'
import { App } from './App'

// Only external contracts are doubled: PDF.js and the preload storage bridge.
// App, Reader, RightPanel, AnnotationsPanel and selection actions stay real.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: 'worker' }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    destroy: async () => {},
    promise: Promise.resolve({
      numPages: 1,
      getOutline: async () => null,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100, scale: 1, userUnit: 1 }),
        getTextContent: async () => ({ items: [{ str: 'Research evidence' }] }),
      }),
    }),
  }),
  TextLayer: class {
    constructor(private options: { container: HTMLElement; textContentSource: { items: { str: string }[] } }) {}
    async render(): Promise<void> {
      for (const item of this.options.textContentSource.items) {
        const span = document.createElement('span')
        span.textContent = item.str
        this.options.container.append(span)
      }
    }
  },
}))

const papers = [
  { slug: 'paper-a', title: 'Research Paper A', authors: [], addedAt: 'now' },
  { slug: 'paper-b', title: 'Research Paper B', authors: [], addedAt: 'now' },
]
let records: HighlightRecord[]
let create: ReturnType<typeof vi.fn<Window['vellum']['highlightsCreate']>>
let list: ReturnType<typeof vi.fn<Window['vellum']['highlightsList']>>

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  records = []
  list = vi.fn(async (slug) => records.filter((record) => record.paperSlug === slug))
  create = vi.fn(async (params) => {
    const record = { ...params, id: `highlight-${records.length + 1}`, paperSlug: params.slug, createdAt: 'now' }
    records.push(record)
    return record
  })
  const bridge: Partial<Window['vellum']> = {
    ping: async () => 'pong',
    listPapers: async () => papers,
    collectionsTree: async () => [],
    collectionsForPaper: async () => [],
    readPaperFile: async () => new ArrayBuffer(8),
    askOpen: () => new Promise(() => {}),
    onAskUpdate: () => () => {},
    highlightsList: list,
    highlightsCreate: create,
    highlightsDelete: async () => {},
    notesGet: async () => null,
  }
  Object.defineProperty(window, 'vellum', { configurable: true, value: bridge })
})

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
  vi.restoreAllMocks()
})

async function openPaper(title = 'Research Paper A'): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Library' }))
  fireEvent.click(await screen.findByText(title))
  await waitFor(() => expect(document.querySelector('[class*="textLayer"] span')).toHaveTextContent('Research evidence'))
}

async function selectText(): Promise<void> {
  const layer = document.querySelector('[class*="textLayer"]')!
  const text = layer.querySelector('span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 17)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fireEvent.mouseUp(layer)
  await act(async () => {})
}

function annotations(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Paper panel' })
}

async function openAnnotations(): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: 'Annotations' }))
  await screen.findByText(/No highlights yet/)
}

it('shows saved quote, page and color immediately in the already open Annotations tab', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await selectText()
  fireEvent.click(screen.getByRole('button', { name: 'Highlight yellow' }))

  const rowButton = await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })
  expect(rowButton.querySelector('[style]')).toHaveStyle({ background: 'yellow' })
  expect(within(annotations()).getAllByRole('button', { name: 'Delete highlight: Research evidence' })).toHaveLength(1)
  expect(screen.getByRole('tab', { name: 'Annotations' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(rowButton)
  expect(screen.getByLabelText('Page', { exact: true })).toHaveTextContent('1 of 1')
})

it('refreshes after each creation from both selection actions and highlight mode', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await selectText()
  fireEvent.click(screen.getByRole('button', { name: 'Highlight yellow' }))
  await within(annotations()).findByText('Research evidence')
  fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
  fireEvent.click(screen.getByRole('button', { name: 'green highlight color' }))
  await selectText()

  await waitFor(() => expect(within(annotations()).getAllByRole('button', { name: 'Delete highlight: Research evidence' })).toHaveLength(2))
  const rows = within(annotations()).getAllByRole('button', { name: 'Research evidence Page 1' })
  expect(rows[0].querySelector('[style]')).toHaveStyle({ background: 'yellow' })
  expect(rows[1].querySelector('[style]')).toHaveStyle({ background: 'green' })
})

it('does not publish a refresh or fabricate a row after failed creation', async () => {
  create.mockRejectedValue(new Error('storage unavailable'))
  render(<App />)
  await openPaper()
  await openAnnotations()
  const readsBeforeFailure = list.mock.calls.length
  await selectText()
  fireEvent.click(screen.getByRole('button', { name: 'Highlight yellow' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  await act(async () => {})

  expect(list).toHaveBeenCalledTimes(readsBeforeFailure)
  expect(within(annotations()).getByText(/No highlights yet/)).toBeVisible()
  expect(within(annotations()).queryByRole('button', { name: /Delete highlight/ })).toBeNull()
})

it('loads a creation made while Annotations was closed when the tab opens later', async () => {
  render(<App />)
  await openPaper()
  await selectText()
  fireEvent.click(screen.getByRole('button', { name: 'Highlight blue' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  await act(async () => {})
  fireEvent.click(screen.getByRole('tab', { name: 'Annotations' }))
  expect(await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })).toBeVisible()
})

it('keeps the current paper list when an outgoing paper creation completes, and loads the saved row on return', async () => {
  const save = create.getMockImplementation()!
  let finish!: () => Promise<void>
  create.mockImplementationOnce((params) => new Promise((resolve) => {
    finish = async () => resolve(await save(params))
  }))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await selectText()
  fireEvent.click(screen.getByRole('button', { name: 'Highlight pink' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  await openPaper('Research Paper B')
  await within(annotations()).findByText(/No highlights yet/)
  const readsBeforeCompletion = list.mock.calls.length
  await act(async () => { await finish() })

  expect(list).toHaveBeenCalledTimes(readsBeforeCompletion)
  expect(within(annotations()).getByText(/No highlights yet/)).toBeVisible()
  expect(within(annotations()).queryByText('Research evidence')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  expect(await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })).toBeVisible()
})
