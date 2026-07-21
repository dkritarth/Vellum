// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
})
