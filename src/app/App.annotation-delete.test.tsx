// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HighlightRecord } from "../../core/highlights/repo"
import { App } from "./App"

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
    // #203's per-page text layers cancel on unmount.
    cancel(): void {}
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
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{left:10,top:20,width:90,height:12,right:100,bottom:32}] })
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
    highlightsDelete: async (id) => { records = records.filter(record => record.id !== id) },
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

it('removes the rendered Reader overlay when its annotation is deleted', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await saveHighlight()
  await within(annotations()).findByRole('button', { name: 'Delete highlight: Research evidence' })
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  fireEvent.click(within(annotations()).getByRole('button', { name: 'Delete highlight: Research evidence' }))
  await within(annotations()).findByText(/No highlights yet/)
  expect(records).toHaveLength(0)
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(0)
})

it('retains Reader overlay when annotation deletion fails', async () => {
  window.vellum.highlightsDelete = vi.fn(async () => { throw new Error('delete rejected') })
  render(<App />)
  await openPaper()
  await openAnnotations()
  await saveHighlight()
  await within(annotations()).findByRole('button', { name: 'Delete highlight: Research evidence' })
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  const readsBefore = list.mock.calls.length
  fireEvent.click(within(annotations()).getByRole('button', { name: 'Delete highlight: Research evidence' }))
  await act(async () => {})
  expect(list).toHaveBeenCalledTimes(readsBefore)
  expect(records).toHaveLength(1)
  expect(within(annotations()).getByRole('button', { name: 'Delete highlight: Research evidence' })).toBeVisible()
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1)
})

async function saveHighlight(color = 'yellow'): Promise<void> {
  await selectText()
  fireEvent.click(screen.getByRole('button', { name: `Highlight ${color}` }))
  await act(async () => {})
}

it('deletes only the selected overlay and retains other creations and the open list', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await saveHighlight()
  await saveHighlight('green')
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(2))
  fireEvent.click(within(annotations()).getAllByRole('button', { name: 'Delete highlight: Research evidence' })[0])
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'green' })
  expect(records.map(record => record.color)).toEqual(['green'])
  expect(within(annotations()).getAllByRole('button', { name: /Delete highlight/ })).toHaveLength(1)
  expect(screen.getByRole('tab', { name: 'Annotations' })).toHaveAttribute('aria-selected', 'true')
})

it('scopes a late outgoing deletion to its paper and loads the deletion on return', async () => {
  let finish!: () => void
  window.vellum.highlightsDelete = (id) => new Promise(resolve => {
    finish = () => { records = records.filter(record => record.id !== id); resolve() }
  })
  render(<App />)
  await openPaper()
  await openAnnotations()
  await openPaper('Research Paper B')
  await saveHighlight('blue')
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  // #203 reloads the paper's pages on tab switch; wait for its text layer.
  await waitFor(() => expect(document.querySelector('[class*="textLayer"] span')).toHaveTextContent('Research evidence'))
  await saveHighlight()
  fireEvent.click(within(annotations()).getByRole('button', { name: /Delete highlight/ }))
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper B' }))
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  const readsBefore = list.mock.calls.length
  await act(async () => finish())
  expect(list).toHaveBeenCalledTimes(readsBefore)
  expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'blue' })
  expect(within(annotations()).getAllByRole('button', { name: /Delete highlight/ })).toHaveLength(1)
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  await within(annotations()).findByText(/No highlights yet/)
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(0))
})

it.each(['success', 'failure'])('ignores obsolete Reader %s after a newer creation', async (completion) => {
  let resolve!: (records: HighlightRecord[]) => void
  let reject!: (reason: Error) => void
  list.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await saveHighlight()
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  await act(async () => { if (completion === 'success') resolve([]); else reject(new Error('old read failed')) })
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1)
})

it.each(['success', 'failure'])('ignores obsolete refresh %s after subsequent deletion', async (completion) => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await saveHighlight()
  await saveHighlight('green')
  const pending: { resolve: (records: HighlightRecord[]) => void; reject: (reason: Error) => void }[] = []
  const read = list.getMockImplementation()!
  list.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
  fireEvent.click(within(annotations()).getAllByRole('button', { name: /Delete highlight/ })[0])
  await waitFor(() => expect(records).toHaveLength(1))
  await act(async () => {})
  const oldRecords = [...records]
  list.mockImplementation(read)
  // Persisted deletion is removed immediately while refresh waits. Delete remaining saved record.
  fireEvent.click(within(annotations()).getAllByRole('button', { name: /Delete highlight/ })[0])
  await within(annotations()).findByText(/No highlights yet/)
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(0))
  await act(async () => { for (const request of pending) {
    if (completion === 'success') request.resolve(oldRecords)
    else request.reject(new Error('obsolete refresh failed'))
  } })
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(0)
  expect(within(annotations()).getByText(/No highlights yet/)).toBeVisible()
})

it('ignores a Reader read from an earlier visit after returning to the same paper', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await openPaper('Research Paper B')
  await saveHighlight('blue')
  let finish!: (rows: HighlightRecord[]) => void
  list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  await act(async () => {})
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper B' }))
  await act(async () => {})
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  await within(annotations()).findByText(/No highlights yet/)
  await saveHighlight('green')
  await waitFor(() => expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'green' }))
  await act(async () => finish([]))
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1)
  expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'green' })
})

it('keeps current overlays when an outgoing creation completes', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await openPaper('Research Paper B')
  await saveHighlight('blue')
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  await within(annotations()).findByText(/No highlights yet/)
  const save = create.getMockImplementation()!
  let finish!: () => Promise<void>
  create.mockImplementationOnce(params => new Promise(resolve => {
    finish = async () => resolve(await save(params))
  }))
  await saveHighlight('pink')
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper B' }))
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  const readsBefore = list.mock.calls.length
  await act(async () => finish())
  expect(list).toHaveBeenCalledTimes(readsBefore)
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1)
  expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'blue' })
  fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
  await waitFor(() => expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'pink' }))
})

it('keeps failed deletion in storage/list/Reader until explicit retry succeeds', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await saveHighlight()
  await saveHighlight('green')
  const saved = [...records]
  const original = window.vellum.highlightsDelete
  const remove = vi.fn().mockRejectedValueOnce(new Error('injected delete failure')).mockImplementation(original)
  window.vellum.highlightsDelete = remove
  fireEvent.click(within(annotations()).getAllByRole('button', { name: /Delete highlight:/ })[0])
  await within(annotations()).findByRole('alert')
  expect(records).toEqual(saved)
  expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(2)
  expect(within(annotations()).getAllByRole('button', { name: /Delete highlight:/ })).toHaveLength(2)
  fireEvent.click(within(annotations()).getByRole('button', { name: /Retry deleting highlight:/ }))
  await waitFor(() => expect(document.querySelectorAll('[class*="highlightRect"]')).toHaveLength(1))
  expect(remove.mock.calls).toEqual([[saved[0].id], [saved[0].id]])
  expect(records).toEqual([saved[1]])
  expect(document.querySelector('[class*="highlightRect"]')).toHaveStyle({ background: 'green' })
  expect(within(annotations()).queryByRole('alert')).not.toBeInTheDocument()
})
