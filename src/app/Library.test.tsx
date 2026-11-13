// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Library } from './Library'
import type { PaperRecord } from '../../core/library/repo'

function makePaper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    slug: 'arxiv-1706.03762',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

let listPapers: ReturnType<typeof vi.fn>

beforeEach(() => {
  listPapers = vi.fn().mockResolvedValue([])
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: { listPapers },
  })
})

afterEach(() => {
  cleanup()
})

describe('Library', () => {
  it('fetches papers on mount and renders a card per row (title, authors, year)', async () => {
    listPapers.mockResolvedValue([
      makePaper(),
      makePaper({ slug: 'arxiv-2401.1', title: 'BERT', authors: ['Jacob Devlin'], year: 2019 }),
    ])

    render(<Library onOpenPaper={vi.fn()} />)

    expect(await screen.findByText('Attention Is All You Need')).toBeInTheDocument()
    expect(screen.getByText('BERT')).toBeInTheDocument()
    expect(screen.getByText(/Ashish Vaswani/)).toBeInTheDocument()
    expect(screen.getByText(/2017/)).toBeInTheDocument()
    expect(listPapers).toHaveBeenCalled()
  })

  it('shows a friendly empty state when there are no papers, without crashing', async () => {
    listPapers.mockResolvedValue([])

    render(<Library onOpenPaper={vi.fn()} />)

    expect(await screen.findByText(/no papers yet/i)).toBeInTheDocument()
  })

  it('shows an error state if the IPC call rejects, without crashing', async () => {
    listPapers.mockRejectedValue(new Error('db locked'))

    render(<Library onOpenPaper={vi.fn()} />)

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
  })

  it('clicking a card calls onOpenPaper with that paper\'s slug + title', async () => {
    const user = userEvent.setup()
    listPapers.mockResolvedValue([makePaper()])
    const onOpenPaper = vi.fn()

    render(<Library onOpenPaper={onOpenPaper} />)

    const card = await screen.findByText('Attention Is All You Need')
    await user.click(card)

    expect(onOpenPaper).toHaveBeenCalledWith({ slug: 'arxiv-1706.03762', title: 'Attention Is All You Need' })
  })

  it('typing in the search box re-queries listPapers with the search term', async () => {
    const user = userEvent.setup()
    listPapers.mockResolvedValue([])

    render(<Library onOpenPaper={vi.fn()} />)
    await waitFor(() => expect(listPapers).toHaveBeenCalledTimes(1))

    await user.type(screen.getByLabelText(/search/i), 'bert')

    await waitFor(() => {
      const lastCall = listPapers.mock.calls[listPapers.mock.calls.length - 1]
      expect(lastCall[0]).toMatchObject({ search: 'bert' })
    })
  })

  it('changing the sort control re-queries listPapers with the chosen sort column', async () => {
    const user = userEvent.setup()
    listPapers.mockResolvedValue([])

    render(<Library onOpenPaper={vi.fn()} />)
    await waitFor(() => expect(listPapers).toHaveBeenCalledTimes(1))

    await user.selectOptions(screen.getByLabelText(/sort/i), 'year')

    await waitFor(() => {
      const lastCall = listPapers.mock.calls[listPapers.mock.calls.length - 1]
      expect(lastCall[0]).toMatchObject({ sort: 'year' })
    })
  })

  it('empty state message differs when a search has no matches vs. no papers at all', async () => {
    const user = userEvent.setup()
    listPapers.mockResolvedValue([])

    render(<Library onOpenPaper={vi.fn()} />)
    expect(await screen.findByText(/no papers yet/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/search/i), 'nonexistent')

    await waitFor(() => expect(screen.getByText(/no papers match/i)).toBeInTheDocument())
  })
  it('filters by selectedCollectionId and renders filter banner and collection tags [L2-01]', async () => {
    listPapers.mockResolvedValue([makePaper({ slug: 'paper-1', title: 'Paper in Collection' })])
    const collectionsForPaper = vi.fn().mockResolvedValue([{ id: 10, name: 'Machine Learning', parentId: null }])
    Object.defineProperty(window, 'vellum', {
      configurable: true,
      value: { listPapers, collectionsForPaper },
    })

    const onClear = vi.fn()
    render(
      <Library
        onOpenPaper={vi.fn()}
        selectedCollectionId={10}
        selectedCollectionName="Machine Learning"
        onClearCollectionFilter={onClear}
      />
    )

    expect(await screen.findByText(/Filtered by collection:/)).toBeInTheDocument()
    expect(screen.getAllByText('Machine Learning').length).toBe(2)
    expect(listPapers).toHaveBeenCalledWith(expect.objectContaining({ collectionId: 10 }))

    const clearBtn = screen.getByRole('button', { name: 'Clear filter' })
    clearBtn.click()
    expect(onClear).toHaveBeenCalled()
  })
  it('clicking trash button on a paper card invokes paperTrash and removes it [L2-04]', async () => {
    listPapers.mockResolvedValue([makePaper()])
    const paperTrash = vi.fn().mockResolvedValue(null)
    const collectionsForPaper = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'vellum', {
      configurable: true,
      value: { listPapers, collectionsForPaper, paperTrash },
    })

    const onTrash = vi.fn()
    render(<Library onOpenPaper={vi.fn()} onTrashPaper={onTrash} />)

    const trashBtn = await screen.findByRole('button', { name: 'Move Attention Is All You Need to trash' })
    fireEvent.click(trashBtn)

    await waitFor(() => {
      expect(paperTrash).toHaveBeenCalledWith('arxiv-1706.03762')
      expect(onTrash).toHaveBeenCalledWith('arxiv-1706.03762')
      expect(screen.queryByText('Attention Is All You Need')).not.toBeInTheDocument()
    })
  })

  it('adds a paper to a collection from the card control and shows the new tag', async () => {
    listPapers.mockResolvedValue([makePaper()])
    let assigned = false
    const collectionsForPaper = vi.fn(async () => (assigned ? [{ id: 2, name: 'AI', parentId: 1 }] : []))
    const collectionsList = vi.fn().mockResolvedValue([
      { id: 1, name: 'Computer Science', parentId: null },
      { id: 2, name: 'AI', parentId: 1 },
    ])
    const collectionsAssign = vi.fn(async () => {
      assigned = true
    })
    Object.defineProperty(window, 'vellum', {
      configurable: true,
      value: { listPapers, collectionsForPaper, collectionsList, collectionsAssign },
    })
    const user = userEvent.setup()
    render(<Library onOpenPaper={vi.fn()} />)

    const select = await screen.findByRole('combobox', { name: 'Add to collection: Attention Is All You Need' })
    // Nested collections are listed with their full path.
    expect(await screen.findByRole('option', { name: 'Computer Science / AI' })).toBeInTheDocument()
    await user.selectOptions(select, '2')

    expect(collectionsAssign).toHaveBeenCalledWith({ paperSlug: 'arxiv-1706.03762', collectionId: 2 })
    expect(await screen.findByText('AI')).toBeInTheDocument()
    // Control resets to its prompt, and the paper's own collection is no longer offered.
    expect(select).toHaveValue('')
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Computer Science / AI' })).not.toBeInTheDocument())
  })

  it('makes cards draggable with the paper slug as drag data', async () => {
    listPapers.mockResolvedValue([makePaper()])
    render(<Library onOpenPaper={vi.fn()} />)

    const card = (await screen.findByText('Attention Is All You Need')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveAttribute('draggable', 'true')
    const setData = vi.fn()
    fireEvent.dragStart(card, { dataTransfer: { setData, effectAllowed: '' } })
    expect(setData).toHaveBeenCalledWith('application/x-vellum-paper', 'arxiv-1706.03762')
  })

  it('removes a paper from the filtered collection', async () => {
    listPapers.mockResolvedValue([makePaper()])
    const collectionsRemove = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'vellum', {
      configurable: true,
      value: { listPapers, collectionsRemove, collectionsForPaper: vi.fn().mockResolvedValue([]) },
    })
    const user = userEvent.setup()
    render(<Library onOpenPaper={vi.fn()} selectedCollectionId={7} selectedCollectionName="Reading" />)

    await user.click(await screen.findByRole('button', { name: 'Remove from collection: Attention Is All You Need' }))

    expect(collectionsRemove).toHaveBeenCalledWith({ paperSlug: 'arxiv-1706.03762', collectionId: 7 })
    await waitFor(() => expect(screen.queryByText('Attention Is All You Need')).not.toBeInTheDocument())
  })

  it('says the collection is empty (not the library) when a filtered collection has no papers', async () => {
    listPapers.mockResolvedValue([])
    render(<Library onOpenPaper={vi.fn()} selectedCollectionId={7} selectedCollectionName="Reading" />)

    expect(await screen.findByText(/no papers in this collection yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/ingest one to get started/i)).not.toBeInTheDocument()
  })

  it('re-queries when refreshNonce changes (e.g. a paper was dropped on a collection)', async () => {
    listPapers.mockResolvedValue([])
    const { rerender } = render(<Library onOpenPaper={vi.fn()} refreshNonce={0} />)
    await waitFor(() => expect(listPapers).toHaveBeenCalledTimes(1))
    rerender(<Library onOpenPaper={vi.fn()} refreshNonce={1} />)
    await waitFor(() => expect(listPapers).toHaveBeenCalledTimes(2))
  })
})
