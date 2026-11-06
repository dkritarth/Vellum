// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationsPanel } from './AnnotationsPanel'

let highlightsList: ReturnType<typeof vi.fn>
let highlightsDelete: ReturnType<typeof vi.fn>

const HIGHLIGHTS = [
  { id: 'h1', paperSlug: 'p1', page: 2, color: 'yellow', quote: 'first highlight', anchor: '{}', createdAt: 't1' },
  { id: 'h2', paperSlug: 'p1', page: 5, color: 'blue', quote: 'second highlight', anchor: '{}', createdAt: 't2' },
]

beforeEach(() => {
  highlightsList = vi.fn().mockResolvedValue(HIGHLIGHTS)
  highlightsDelete = vi.fn().mockResolvedValue(undefined)

  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: { highlightsList, highlightsDelete },
  })
})

afterEach(() => {
  cleanup()
})

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('AnnotationsPanel', () => {
  it('shows a placeholder and never calls window.vellum when no paper is open', () => {
    render(<AnnotationsPanel />)

    expect(screen.getByText(/open a paper/i)).toBeInTheDocument()
    expect(highlightsList).not.toHaveBeenCalled()
  })

  it('loads and lists highlights for the open paper (color, quote, page)', async () => {
    render(<AnnotationsPanel slug="p1" />)
    await flushPromises()

    expect(highlightsList).toHaveBeenCalledWith('p1')
    expect(screen.getByText('first highlight')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(screen.getByText('second highlight')).toBeInTheDocument()
    expect(screen.getByText('Page 5')).toBeInTheDocument()
  })

  it('shows an empty state when the paper has no highlights', async () => {
    highlightsList.mockResolvedValue([])

    render(<AnnotationsPanel slug="p1" />)
    await flushPromises()

    expect(screen.getByText(/no highlights yet/i)).toBeInTheDocument()
  })

  it('calls onJump with the highlight when a row is clicked', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<AnnotationsPanel slug="p1" onJump={onJump} />)
    await flushPromises()

    await user.click(screen.getByText('first highlight'))

    expect(onJump).toHaveBeenCalledWith(HIGHLIGHTS[0])
  })

  it('deletes a highlight and refreshes the list', async () => {
    const user = userEvent.setup()
    render(<AnnotationsPanel slug="p1" />)
    await flushPromises()

    highlightsList.mockResolvedValue([HIGHLIGHTS[1]])
    await user.click(screen.getByRole('button', { name: /delete highlight: first highlight/i }))
    await flushPromises()

    expect(highlightsDelete).toHaveBeenCalledWith('h1')
    expect(highlightsList).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('first highlight')).not.toBeInTheDocument()
    expect(screen.getByText('second highlight')).toBeInTheDocument()
  })

  it('reloads highlights when switching to a different paper', async () => {
    highlightsList.mockResolvedValueOnce(HIGHLIGHTS).mockResolvedValueOnce([])

    const { rerender } = render(<AnnotationsPanel slug="p1" />)
    await flushPromises()
    expect(screen.getByText('first highlight')).toBeInTheDocument()

    rerender(<AnnotationsPanel slug="p2" />)
    await flushPromises()

    expect(highlightsList).toHaveBeenCalledWith('p2')
    expect(screen.getByText(/no highlights yet/i)).toBeInTheDocument()
  })

  it('ignores a slow highlight list for the previous paper after the slug changes', async () => {
    let resolveP1: (rows: typeof HIGHLIGHTS) => void = () => undefined
    highlightsList.mockImplementation((slug: string) =>
      slug === 'p1'
        ? new Promise((resolve) => {
            resolveP1 = resolve
          })
        : Promise.resolve([{ ...HIGHLIGHTS[0], id: 'h9', paperSlug: 'p2', quote: 'p2 highlight' }]),
    )
    const { rerender } = render(<AnnotationsPanel slug="p1" />)
    rerender(<AnnotationsPanel slug="p2" />)
    expect(await screen.findByText('p2 highlight')).toBeInTheDocument()

    await act(async () => {
      resolveP1(HIGHLIGHTS)
    })

    expect(screen.queryByText('first highlight')).not.toBeInTheDocument()
    expect(screen.getByText('p2 highlight')).toBeInTheDocument()
  })

  it('clears the previous paper highlights while the next paper loads', async () => {
    highlightsList.mockImplementation((slug: string) =>
      slug === 'p1' ? Promise.resolve(HIGHLIGHTS) : new Promise(() => undefined),
    )
    const { rerender } = render(<AnnotationsPanel slug="p1" />)
    expect(await screen.findByText('first highlight')).toBeInTheDocument()

    rerender(<AnnotationsPanel slug="p2" />)

    expect(screen.queryByText('first highlight')).not.toBeInTheDocument()
  })
})

// Refreshes can overlap an initial read or another creation's read for the
// same paper. Slug equality alone cannot distinguish those requests.
describe('creation refresh ordering', () => {
  it.each(['success', 'error'] as const)('ignores obsolete same-paper list %s after a newer refresh', async (outcome) => {
    let resolveOld!: (rows: typeof HIGHLIGHTS) => void
    let rejectOld!: (reason: Error) => void
    highlightsList.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveOld = resolve
      rejectOld = reject
    })).mockResolvedValue(HIGHLIGHTS)
    const { rerender } = render(<AnnotationsPanel slug="p1" highlightsRevision={0} />)
    rerender(<AnnotationsPanel slug="p1" highlightsRevision={1} />)
    const row = await screen.findByRole('button', { name: 'first highlight Page 2' })
    row.focus()

    await act(async () => {
      if (outcome === 'success') resolveOld([])
      else rejectOld(new Error('obsolete read failed'))
    })

    expect(row).toBeInTheDocument()
    expect(row).toHaveFocus()
    expect(screen.queryByText(/no highlights yet/i)).not.toBeInTheDocument()
  })

  it('does not finish current loading when an obsolete request settles', async () => {
    let resolveOld!: (rows: typeof HIGHLIGHTS) => void
    let resolveNew!: (rows: typeof HIGHLIGHTS) => void
    highlightsList.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve }))
    const { rerender } = render(<AnnotationsPanel slug="p1" highlightsRevision={0} />)
    rerender(<AnnotationsPanel slug="p1" highlightsRevision={1} />)
    await act(async () => { resolveOld([]) })
    expect(screen.queryByText(/no highlights yet/i)).not.toBeInTheDocument()
    await act(async () => { resolveNew(HIGHLIGHTS) })
    expect(screen.getByText('first highlight')).toBeVisible()
  })

  it('preserves row focus during refresh and ignores reads from an earlier visit to the same paper', async () => {
    let resolveOld!: (rows: typeof HIGHLIGHTS) => void
    highlightsList.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValue(HIGHLIGHTS)
    const { rerender } = render(<AnnotationsPanel slug="p1" />)
    rerender(<AnnotationsPanel slug="p2" />)
    await flushPromises()
    rerender(<AnnotationsPanel slug="p1" />)
    const row = await screen.findByRole('button', { name: 'first highlight Page 2' })
    row.focus()
    rerender(<AnnotationsPanel slug="p1" highlightsRevision={1} />)
    await flushPromises()
    expect(row).toHaveFocus()
    await act(async () => { resolveOld([]) })
    expect(row).toBeInTheDocument()
  })
})

describe('persisted deletion notification', () => {
  it('reports the originating paper only after a successful late deletion', async () => {
    let finish!: () => void
    highlightsDelete.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const onHighlightDeleted = vi.fn()
    const { rerender } = render(<AnnotationsPanel slug="p1" onHighlightDeleted={onHighlightDeleted} />)
    await flushPromises()
    await userEvent.click(screen.getByRole('button', { name: /delete highlight: first highlight/i }))
    expect(onHighlightDeleted).not.toHaveBeenCalled()
    highlightsList.mockResolvedValue([])
    rerender(<AnnotationsPanel slug="p2" onHighlightDeleted={onHighlightDeleted} />)
    await flushPromises()
    const readsBefore = highlightsList.mock.calls.length
    await act(async () => finish())
    expect(onHighlightDeleted).toHaveBeenCalledTimes(1)
    expect(onHighlightDeleted).toHaveBeenCalledWith('p1')
    expect(highlightsList).toHaveBeenCalledTimes(readsBefore)
    expect(screen.getByText(/no highlights yet/i)).toBeVisible()
  })

  it('preserves rows and publishes no success on failed deletion', async () => {
    highlightsDelete.mockRejectedValueOnce(new Error('delete rejected'))
    const onHighlightDeleted = vi.fn()
    render(<AnnotationsPanel slug="p1" onHighlightDeleted={onHighlightDeleted} />)
    await flushPromises()
    await userEvent.click(screen.getByRole('button', { name: /delete highlight: first highlight/i }))
    await flushPromises()
    expect(onHighlightDeleted).not.toHaveBeenCalled()
    expect(highlightsList).toHaveBeenCalledTimes(1)
    expect(screen.getByText('first highlight')).toBeVisible()
  })
})
