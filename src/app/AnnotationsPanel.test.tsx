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

describe('operation errors', () => {
  it('distinguishes failed initial loading from empty and retries repeated failures to recovery', async () => {
    highlightsList.mockRejectedValueOnce(Error('read')).mockRejectedValueOnce(Error('read again')).mockResolvedValue([])
    render(<AnnotationsPanel slug="p1" />)
    await flushPromises()
    expect(screen.queryByText(/no highlights yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/load highlights/i)
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading highlights' }))
    expect(screen.getByRole('alert')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading highlights' }))
    expect(await screen.findByText(/no highlights yet/i)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps known row identity, focus and jump usable after refresh failure', async () => {
    const onJump = vi.fn()
    const { rerender } = render(<AnnotationsPanel slug="p1" onJump={onJump} />)
    const row = await screen.findByRole('button', { name: 'first highlight Page 2' })
    row.focus()
    highlightsList.mockRejectedValueOnce(Error('refresh failed'))
    rerender(<AnnotationsPanel slug="p1" highlightsRevision={1} onJump={onJump} />)
    await flushPromises()
    expect(row).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent(/load highlights/i)
    await userEvent.keyboard('{Enter}')
    expect(onJump).toHaveBeenCalledWith(HIGHLIGHTS[0])
  })

  it('retries only the failed delete, retains other rows and publishes only persisted success', async () => {
    const onHighlightDeleted = vi.fn()
    highlightsDelete.mockRejectedValueOnce(Error('delete')).mockRejectedValueOnce(Error('again')).mockResolvedValue(undefined)
    render(<AnnotationsPanel slug="p1" onHighlightDeleted={onHighlightDeleted} />)
    await flushPromises()
    await userEvent.click(screen.getByRole('button', { name: 'Delete highlight: first highlight' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/delete highlight/i)
    expect(screen.getByText('first highlight')).toBeVisible()
    expect(onHighlightDeleted).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry deleting highlight: first highlight' }))
    expect(screen.getByRole('alert')).toBeVisible()
    highlightsList.mockResolvedValue([HIGHLIGHTS[1]])
    await userEvent.click(screen.getByRole('button', { name: 'Retry deleting highlight: first highlight' }))
    expect(highlightsDelete.mock.calls).toEqual([['h1'], ['h1'], ['h1']])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('first highlight')).not.toBeInTheDocument()
    expect(screen.getByText('second highlight')).toBeVisible()
    expect(onHighlightDeleted).toHaveBeenCalledTimes(1)
    expect(onHighlightDeleted).toHaveBeenCalledWith('p1')
  })
})

describe('error ownership', () => {
  it.each(['load', 'delete'] as const)('ignores late %s failure after switching away and revisiting', async (operation) => {
    let reject!: (error: Error) => void
    const { rerender } = render(<AnnotationsPanel slug="p1" />)
    await flushPromises()
    const deferred = () => new Promise<never>((_, fail) => { reject = fail })
    if (operation === 'delete') {
      highlightsDelete.mockImplementationOnce(deferred)
      await userEvent.click(screen.getByRole('button', { name: 'Delete highlight: first highlight' }))
    } else {
      highlightsList.mockImplementationOnce(deferred)
      rerender(<AnnotationsPanel slug="p1" highlightsRevision={1} />)
    }
    highlightsList.mockResolvedValue([])
    rerender(<AnnotationsPanel slug="p2" />)
    await flushPromises()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    highlightsList.mockResolvedValue(HIGHLIGHTS)
    rerender(<AnnotationsPanel slug="p1" />)
    await flushPromises()
    await act(async () => reject(Error('old visit failure')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('first highlight')).toBeVisible()
  })

  it('ignores a late retry response after deletion so removed rows cannot return', async () => {
    let finishRetry!: (rows: typeof HIGHLIGHTS) => void
    highlightsList.mockRejectedValueOnce(Error('initial failure'))
    const { rerender } = render(<AnnotationsPanel slug="p1" />)
    await flushPromises()
    highlightsList.mockResolvedValueOnce(HIGHLIGHTS)
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading highlights' }))
    highlightsList.mockRejectedValueOnce(Error('refresh failed'))
    rerender(<AnnotationsPanel slug="p1" highlightsRevision={1} />)
    await flushPromises()
    highlightsList.mockImplementationOnce(() => new Promise(resolve => { finishRetry = resolve }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading highlights' }))
    highlightsList.mockResolvedValue([HIGHLIGHTS[1]])
    await userEvent.click(screen.getByRole('button', { name: 'Delete highlight: first highlight' }))
    await act(async () => finishRetry(HIGHLIGHTS))
    expect(screen.queryByText('first highlight')).not.toBeInTheDocument()
    expect(screen.getByText('second highlight')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retains unrelated delete error when a different row deletes and removes persisted row even if refresh fails', async () => {
    render(<AnnotationsPanel slug="p1" />)
    await flushPromises()
    highlightsDelete.mockRejectedValueOnce(Error('h1 failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete highlight: first highlight' }))
    highlightsList.mockRejectedValueOnce(Error('refresh failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete highlight: second highlight' }))
    expect(screen.queryByText('second highlight')).not.toBeInTheDocument()
    expect(screen.getByText('first highlight')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry deleting highlight: first highlight' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Retry loading highlights' })).toBeEnabled()
  })

  it('keeps loading distinct from successful empty and prevents duplicate pending retries', async () => {
    let resolve!: (rows: typeof HIGHLIGHTS) => void
    highlightsList.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    render(<AnnotationsPanel slug="p1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading highlights')
    expect(screen.queryByText(/no highlights yet/i)).not.toBeInTheDocument()
    await act(async () => resolve(HIGHLIGHTS))
    let finish!: () => void
    highlightsDelete.mockRejectedValueOnce(Error('failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete highlight: first highlight' }))
    highlightsDelete.mockImplementationOnce(() => new Promise<void>(done => { finish = done }))
    const retry = screen.getByRole('button', { name: 'Retry deleting highlight: first highlight' })
    await userEvent.click(retry)
    expect(retry).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete highlight: first highlight' })).toBeDisabled()
    await userEvent.click(retry)
    expect(highlightsDelete).toHaveBeenCalledTimes(2)
    highlightsList.mockResolvedValue([HIGHLIGHTS[1]])
    await act(async () => finish())
  })
})
