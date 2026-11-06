// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      numPages: 2,
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
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ left: 1, top: 2, width: 15, height: 10 }] })
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

async function selectText(end = 17): Promise<void> {
  const layer = document.querySelector('[class*="textLayer"]')!
  const text = layer.querySelector('span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, end)
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


const retry = () => screen.getByRole('button', { name: 'Retry saving highlight' })
const overlays = () => document.querySelectorAll('[class*="highlightRect"]')

async function submit(mode: 'menu' | 'highlight mode'): Promise<void> {
  if (mode === 'highlight mode') {
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    fireEvent.click(screen.getByRole('button', { name: 'blue highlight color' }))
  }
  await selectText()
  if (mode === 'menu') fireEvent.click(screen.getByRole('button', { name: 'Highlight pink' }))
}

for (const mode of ['menu', 'highlight mode'] as const) {
  it('recovers repeated ' + mode + ' save failures with captured context and one persisted result', async () => {
    const user = userEvent.setup()
    let reject!: (error: Error) => void
    create.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    create.mockRejectedValueOnce(new Error('Second failure'))
    render(<App />)
    await openPaper()
    await openAnnotations()
    const reads = list.mock.calls.length
    await submit(mode)
    expect(screen.getByRole('status')).toHaveTextContent('Saving highlight')
    expect(retry()).toBeDisabled()
    await selectText() // Same native selection must not submit again while pending.
    fireEvent.click(retry())
    expect(create).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('First failure')))
    expect(screen.getByRole('alert')).toHaveTextContent('Highlight was not saved')
    expect(records).toHaveLength(0)
    expect(overlays()).toHaveLength(0)
    expect(list).toHaveBeenCalledTimes(reads) // Existing success notification must not fire.
    expect(within(annotations()).getByText(/No highlights yet/)).toBeVisible()
    if (mode === 'highlight mode') fireEvent.click(screen.getByRole('button', { name: 'green highlight color' }))
    window.getSelection()?.removeAllRanges() // Retry needs no surviving native selection.
    retry().focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(retry()).toBeEnabled()
    retry().focus()
    await user.keyboard('{Enter}')
    await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry saving highlight' })).toBeNull()
    expect(records).toHaveLength(1)
    expect(overlays()).toHaveLength(1)
    expect(create.mock.calls.map(([input]) => input)).toEqual(Array(3).fill({
      slug: 'paper-a', page: 1, quote: 'Research evidence', anchor: '{"start":0,"end":17}',
      color: mode === 'menu' ? 'pink' : 'blue',
    }))
    expect(within(annotations()).getAllByRole('button', { name: /^Delete highlight:/ })).toHaveLength(1)
    expect(list.mock.calls.length).toBe(reads + 2) // One successful App notification refreshes Reader and panel.
  })
}

it('retires a failed retry when a different selection is made', async () => {
  create.mockRejectedValueOnce(new Error('Failure'))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('menu')
  await screen.findByRole('alert')
  await selectText(8)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry saving highlight' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Highlight green' }))
  await waitFor(() => expect(records).toHaveLength(1))
  expect(records[0]).toMatchObject({ quote: 'Research', color: 'green', anchor: '{"start":0,"end":8}' })
})

for (const change of ['page', 'paper', 'selection'] as const) {
  it('ignores late outgoing failure after changing ' + change, async () => {
    let reject!: (error: Error) => void
    create.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    render(<App />)
    await openPaper()
    await openAnnotations()
    await submit('menu')
    if (change === 'page') fireEvent.click(screen.getByRole('button', { name: '›' }))
    if (change === 'paper') await openPaper('Research Paper B')
    if (change === 'selection') await selectText(8)
    await act(async () => reject(new Error('Delayed failure')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry saving highlight' })).toBeNull()
    expect(records).toHaveLength(0)
    if (change === 'selection') expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible()
    if (change === 'paper') {
      fireEvent.click(screen.getByRole('tab', { name: 'Research Paper A' }))
      expect(screen.queryByRole('alert')).toBeNull()
    }
  })
}

it('retires failed retry on page navigation, including annotation jump', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('menu')
  await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })
  fireEvent.click(screen.getByRole('button', { name: '›' }))
  await waitFor(() => expect(screen.getByLabelText('Page', { exact: true })).toHaveTextContent('2 of 2'))
  create.mockRejectedValueOnce(new Error('Failure'))
  await submit('menu')
  await screen.findByRole('alert')
  fireEvent.click(within(annotations()).getByRole('button', { name: 'Research evidence Page 1' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry saving highlight' })).toBeNull()
  expect(records).toHaveLength(1)
})

it('keeps a new selection when an outgoing save succeeds', async () => {
  const save = create.getMockImplementation()!
  let finish!: () => Promise<void>
  create.mockImplementationOnce((input) => new Promise(resolve => { finish = async () => resolve(await save(input)) }))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('menu')
  await selectText(8)
  await act(async () => { await finish() })
  expect(window.getSelection()?.toString()).toBe('Research')
  expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible()
  expect(records).toHaveLength(1)
  expect(await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })).toBeVisible()
})

it('retires failed retry as soon as native selection changes, without another mouseup', async () => {
  create.mockRejectedValueOnce(new Error('Failure'))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('menu')
  await screen.findByRole('alert')
  const text = document.querySelector('[class*="textLayer"] span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 8)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry saving highlight' })).toBeNull()
})

it('prevents repeated retry while persistence is pending', async () => {
  const save = create.getMockImplementation()!
  let finish!: () => Promise<void>
  create.mockRejectedValueOnce(new Error('Failure'))
  create.mockImplementationOnce((input) => new Promise(resolve => { finish = async () => resolve(await save(input)) }))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('menu')
  await screen.findByRole('alert')
  fireEvent.click(retry())
  fireEvent.click(retry())
  await selectText()
  expect(retry()).toBeDisabled()
  expect(create).toHaveBeenCalledTimes(2)
  expect(records).toHaveLength(0)
  expect(overlays()).toHaveLength(0)
  await act(async () => { await finish() })
  expect(await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })).toBeVisible()
  expect(records).toHaveLength(1)
  expect(overlays()).toHaveLength(1)
})

it('retires failed retry on a jump to the same page', async () => {
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('menu')
  const row = await within(annotations()).findByRole('button', { name: 'Research evidence Page 1' })
  create.mockRejectedValueOnce(new Error('Failure'))
  await submit('menu')
  await screen.findByRole('alert')
  fireEvent.click(row)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry saving highlight' })).toBeNull()
})

it('does not duplicate a pending highlight when native drag passes through a new range then returns to the original selection', async () => {
  create.mockImplementationOnce(() => new Promise(() => {}))
  render(<App />)
  await openPaper()
  await openAnnotations()
  await submit('highlight mode')
  // Real dragging emits selectionchange before mouseup, including intermediate ranges.
  const text = document.querySelector('[class*="textLayer"] span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 8)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  await selectText()
  expect(create).toHaveBeenCalledTimes(1)
  expect(records).toHaveLength(0)
})
