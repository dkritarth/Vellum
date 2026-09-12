// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RightPanel } from './RightPanel'

beforeEach(() => {
  // Annotations tab ([P2-02]) calls highlightsList when a paper is open;
  // these tests render with no slug by default so it's unused, but mocked
  // for the tests below that do open a paper.
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: { highlightsList: vi.fn().mockResolvedValue([]), highlightsDelete: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  cleanup()
})

describe('RightPanel', () => {
  it('defaults to the Ask tab', () => {
    render(<RightPanel />)
    expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/start asking questions/i)).toBeInTheDocument()
  })

  it('renders the stubbed Ask input bar with `/` skills and `@` context triggers', () => {
    render(<RightPanel />)
    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Context' })).toBeInTheDocument()
  })

  it('switches to Details on click and shows its empty state', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Details' }))

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(/metadata will show here/i)).toBeInTheDocument()
  })

  it('switches to Annotations and shows its no-paper-open placeholder', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Annotations' }))

    expect(screen.getByRole('tab', { name: 'Annotations' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/open a paper to view its highlights/i)).toBeInTheDocument()
    expect(window.vellum.highlightsList).not.toHaveBeenCalled()
  })

  it('renders AnnotationsPanel (not a stub) for an open paper', async () => {
    window.vellum.highlightsList = vi
      .fn()
      .mockResolvedValue([{ id: 'h1', paperSlug: 'p1', page: 3, color: 'yellow', quote: 'a quote', anchor: '{}', createdAt: 't' }])
    // RightPanel defaults to the Ask tab, which mounts AskPanel bound to
    // `slug` before we switch to Annotations — a never-resolving promise
    // keeps it harmlessly loading (same pattern as App.test.tsx).
    window.vellum.askOpen = vi.fn(() => new Promise<never>(() => {}))
    window.vellum.onAskUpdate = vi.fn(() => () => {})
    const user = userEvent.setup()
    render(<RightPanel slug="p1" />)

    await user.click(screen.getByRole('tab', { name: 'Annotations' }))

    expect(await screen.findByText('a quote')).toBeInTheDocument()
    expect(screen.getByText('Page 3')).toBeInTheDocument()
  })

  it('threads onJumpToHighlight through to AnnotationsPanel: clicking an annotation row fires it with that highlight', async () => {
    const highlight = { id: 'h1', paperSlug: 'p1', page: 3, color: 'yellow', quote: 'a quote', anchor: '{}', createdAt: 't' }
    window.vellum.highlightsList = vi.fn().mockResolvedValue([highlight])
    window.vellum.askOpen = vi.fn(() => new Promise<never>(() => {}))
    window.vellum.onAskUpdate = vi.fn(() => () => {})
    const onJumpToHighlight = vi.fn()
    const user = userEvent.setup()

    render(<RightPanel slug="p1" onJumpToHighlight={onJumpToHighlight} />)
    await user.click(screen.getByRole('tab', { name: 'Annotations' }))

    const row = await screen.findByText('a quote')
    await user.click(row)

    expect(onJumpToHighlight).toHaveBeenCalledWith(highlight)
  })

  it('switches to Notes and shows its no-paper-open placeholder', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Notes' }))

    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/open a paper to add notes/i)).toBeInTheDocument()
  })

  it('only ever shows one tab panel at a time', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })
})
