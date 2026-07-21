// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// App mounts Reader ([P1-09]), which imports pdfjs-dist. pdfjs-dist's canvas
// module touches browser APIs (DOMMatrix) jsdom doesn't implement — mock it
// the same way Reader.test.tsx does; this test only cares about shell layout.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    render(): Promise<void> {
      return Promise.resolve()
    }
  },
  getDocument: () => ({ promise: new Promise(() => {}) }),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'worker-url' }))

beforeEach(() => {
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      ping: vi.fn().mockResolvedValue('pong'),
      readPaperFile: vi.fn().mockResolvedValue(null),
      listPapers: vi.fn().mockResolvedValue([
        { slug: 'arxiv-1706.03762', title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017, addedAt: '2026-01-01T00:00:00.000Z' },
      ]),
      // Opening a paper mounts RightPanel's AskPanel ([P1-10]) bound to its
      // slug — this test only cares about tab/pane shell behavior, so a
      // never-resolving promise keeps AskPanel harmlessly in its loading
      // state without asserting on it.
      askOpen: vi.fn(() => new Promise(() => {})),
      onAskUpdate: vi.fn(() => () => {}),
    },
  })
})

afterEach(() => {
  cleanup()
})

describe('App shell', () => {
  it('renders with zero papers without crashing', () => {
    render(<App />)

    // Top tab strip empty state.
    expect(screen.getByText(/No papers open/i)).toBeInTheDocument()
    // Sidebar nav.
    expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument()
    // Center pane empty state.
    expect(screen.getByText(/No paper open/i)).toBeInTheDocument()
    // Right panel default tab.
    expect(screen.getByRole('tab', { name: 'Ask' })).toBeInTheDocument()
    // Reader toolbar highlight stub, visible even with no paper open.
    expect(screen.getByRole('button', { name: /highlight/i })).toBeInTheDocument()
    // Workspace switcher.
    expect(screen.getByRole('button', { name: /switch workspace/i })).toBeInTheDocument()
  })

  it('opens Library from the sidebar, then opens a paper into a tab that swaps back to the Reader [P1-08]', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    const card = await screen.findByText('Attention Is All You Need')

    await user.click(card)

    // A tab bound to the paper's slug now exists and is active.
    expect(screen.getByRole('tab', { name: 'Attention Is All You Need' })).toHaveAttribute('aria-selected', 'true')
    // Center pane swapped back to the Reader (Library grid controls no longer shown).
    expect(screen.queryByLabelText(/search papers by title/i)).not.toBeInTheDocument()
    expect(window.vellum.readPaperFile).toHaveBeenCalledWith('arxiv-1706.03762')
  })

  it('clicking an already-open tab switches back to the Reader without duplicating the tab', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    const card = await screen.findByText('Attention Is All You Need')
    await user.click(card)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await screen.findByLabelText(/search papers by title/i)

    await user.click(screen.getByRole('tab', { name: 'Attention Is All You Need' }))

    expect(screen.getAllByRole('tab', { name: 'Attention Is All You Need' })).toHaveLength(1)
    expect(screen.queryByLabelText(/search papers by title/i)).not.toBeInTheDocument()
  })
})
