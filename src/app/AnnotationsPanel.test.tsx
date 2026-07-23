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
})
