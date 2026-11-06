// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
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
      ingest: vi.fn().mockResolvedValue({
        slug: 'arxiv-1706.03762',
        title: 'Attention Is All You Need',
        metadata: { title: 'Attention Is All You Need', authors: ['Ashish Vaswani'] },
        paths: { pdfPath: 'paper.pdf', mdPath: 'paper.md' },
      }),
      // Opening a paper mounts RightPanel's AskPanel ([P1-10]) bound to its
      // slug — this test only cares about tab/pane shell behavior, so a
      // never-resolving promise keeps AskPanel harmlessly in its loading
      // state without asserting on it.
      askOpen: vi.fn(() => new Promise(() => {})),
      onAskUpdate: vi.fn(() => () => {}),
      // [P2-02] Reader/AnnotationsPanel both load a paper's highlights once
      // opened — this test only cares about tab/pane shell behavior.
      highlightsList: vi.fn().mockResolvedValue([]),
      highlightsCreate: vi.fn(),
      highlightsDelete: vi.fn().mockResolvedValue(undefined),
      paperRestore: vi.fn().mockResolvedValue(null),
      paperPurge: vi.fn().mockResolvedValue(true),
      usageGetSummary: vi.fn().mockResolvedValue({
        totalTurns: 0,
        turnsWithMetrics: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        totalCost: null,
        backends: {
          claude: { backend: 'claude', turnsCount: 0, turnsWithMetrics: 0, totalInputTokens: null, totalOutputTokens: null, totalTokens: null, contextUsedLatest: null, contextSizeLatest: null, totalCost: null, costCurrency: null, lastRecordedAt: null },
          codex: { backend: 'codex', turnsCount: 0, turnsWithMetrics: 0, totalInputTokens: null, totalOutputTokens: null, totalTokens: null, contextUsedLatest: null, contextSizeLatest: null, totalCost: null, costCurrency: null, lastRecordedAt: null },
        },
      }),
      usageGetList: vi.fn().mockResolvedValue([]),
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

  it('clicking Create opens IngestModal, and ingesting a paper opens it into a new tab', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /add paper/i })).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/1706\.03762/)
    await user.type(input, '1706.03762')
    await user.click(screen.getByRole('button', { name: /add paper/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'Attention Is All You Need' })).toBeInTheDocument()
  })
  it('switches to Trash view when Trash footer item is clicked [L2-04]', async () => {
    const user = userEvent.setup()
    render(<App />)

    const trashBtn = screen.getByRole('button', { name: 'Trash' })
    await user.click(trashBtn)

    expect(await screen.findByRole('region', { name: 'Trash view' })).toBeInTheDocument()
    expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument()
  })

  it('opens Usage view from the sidebar footer [L2-05]', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Usage' }))

    expect(await screen.findByRole('region', { name: /usage and telemetry view/i })).toBeInTheDocument()
    expect(screen.getByText('ACP Usage & Plan Telemetry')).toBeInTheDocument()
  })
})

// Exercise deletion through the real Sidebar/ChatsList/RightPanel/AskPanel seam.
describe('displayed conversation deletion', () => {
  const slug = 'arxiv-1706.03762'
  async function setup(explicit = false) {
    const user = userEvent.setup()
    let deleted = false
    const snapshot = (id: number) => ({
      session: { id, paperSlug: slug, backend: 'codex', title: null, createdAt: 't' },
      messages: [{ id: id * 10, sessionId: id, role: 'assistant', content: id === 1 ? 'Deleted history' : 'Remaining history', createdAt: 't' }],
    })
    Object.assign(window.vellum, {
      collectionsList: vi.fn().mockResolvedValue([]),
      questionsGet: vi.fn().mockResolvedValue([]),
      getPaper: vi.fn().mockResolvedValue({ slug, title: 'Attention Is All You Need' }),
      askOpen: vi.fn().mockImplementation(() => Promise.resolve(snapshot(deleted ? 2 : 1))),
      askStart: vi.fn().mockResolvedValue({ requestId: 'next' }),
      chatListSessions: vi.fn().mockImplementation(() => Promise.resolve((deleted ? [2] : [1, 2]).map((id) => ({
        id, paperSlug: slug, paperTitle: 'Attention Is All You Need', title: `Conversation ${id}`, backend: 'codex', messageCount: 1, lastActiveAt: '2026-11-01',
      })))),
      chatDeleteSession: vi.fn().mockImplementation(async (id: number) => { if (id === 1) deleted = true }),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(await screen.findByText('Attention Is All You Need'))
    await screen.findByText('Deleted history')
    await user.click(screen.getByRole('tab', { name: 'Chats' }))
    await screen.findByText('Conversation 1')
    if (explicit) await user.click(screen.getByText('Conversation 1'))
    return { user }
  }

  afterEach(() => vi.restoreAllMocks())

  it.each([false, true])('reopens a valid session after deleting displayed chat (explicit=%s)', async (explicit) => {
    const { user } = await setup(explicit)
    await user.click(screen.getByRole('button', { name: 'Delete chat Conversation 1' }))
    await screen.findByText('Remaining history')
    expect(screen.queryByText('Deleted history')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Ask a question'), 'Next question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(window.vellum.askStart).toHaveBeenLastCalledWith({ chatSessionId: 2, slug, text: 'Next question' })
  })

  it.each(['unrelated', 'cancel', 'failure'])('preserves displayed history and draft on %s deletion', async (kind) => {
    const { user } = await setup()
    await user.type(screen.getByLabelText('Ask a question'), 'Keep draft')
    if (kind === 'cancel') vi.mocked(window.confirm).mockReturnValue(false)
    if (kind === 'failure') {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(window.vellum.chatDeleteSession).mockRejectedValue(new Error('delete failed'))
    }
    await user.click(screen.getByRole('button', { name: `Delete chat Conversation ${kind === 'unrelated' ? 2 : 1}` }))
    expect(screen.getByText('Deleted history')).toBeInTheDocument()
    expect(screen.getByLabelText('Ask a question')).toHaveValue('Keep draft')
    expect(window.vellum.askOpen).toHaveBeenCalledTimes(1)
  })
})

// Public App journey: actual Chats options, tabs, Library, and Ask bridge calls.
describe('chat navigation ownership', () => {
  type Paper = NonNullable<Awaited<ReturnType<typeof window.vellum.getPaper>>>
  function deferred() {
    let resolve!: (paper: Paper | null) => void
    let reject!: (error: Error) => void
    const promise = new Promise<Paper | null>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  const papers: Paper[] = ['A', 'B'].map((name) => ({
    slug: `paper-${name.toLowerCase()}`, title: `Paper ${name}`, authors: [],
    addedAt: '2026-01-01', pdfPath: 'paper.pdf', mdPath: 'paper.md',
  }))
  async function setup() {
    const user = userEvent.setup()
    const deleted = new Set<number>()
    Object.assign(window.vellum, {
      listPapers: vi.fn().mockResolvedValue(papers),
      getPaper: vi.fn().mockImplementation(async (slug: string) => papers.find((paper) => paper.slug === slug) ?? null),
      collectionsList: vi.fn().mockResolvedValue([]),
      questionsGet: vi.fn().mockResolvedValue([]),
      chatListSessions: vi.fn().mockResolvedValue(papers.map((paper, i) => ({
        id: i + 1, paperSlug: paper.slug, paperTitle: paper.title, title: `Chat ${i + 1}`,
        backend: 'codex', messageCount: 1, lastActiveAt: '2026-01-01',
      }))),
      askOpen: vi.fn().mockImplementation(async (target: string | { slug: string; sessionId?: number }) => {
        const slug = typeof target === 'string' ? target : target.slug
        const requestedId = typeof target === 'string' ? (slug === 'paper-a' ? 1 : 2) : target.sessionId
        const id = requestedId !== undefined && deleted.has(requestedId) ? 3 : requestedId
        return { session: { id, paperSlug: slug, backend: 'codex', title: null, createdAt: 't' }, messages: [] }
      }),
      askStart: vi.fn().mockResolvedValue({ requestId: 'next' }),
      chatDeleteSession: vi.fn().mockImplementation(async (id: number) => { deleted.add(id) }),
    })
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Chats' }))
    await screen.findByRole('option', { name: /Chat 1/ })
    return { user, chat: (id: number) => screen.getByRole('option', { name: new RegExp(`Chat ${id}`) }) }
  }

  it('keeps latest chat and paper together when lookups finish in reverse order', async () => {
    const { user, chat } = await setup()
    const a = deferred(), b = deferred()
    vi.mocked(window.vellum.getPaper).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await user.click(chat(1))
    await user.click(chat(2))
    await act(async () => b.resolve(papers[1]))
    expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => a.resolve(papers[0]))
    expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
    expect(chat(2)).toHaveAttribute('aria-selected', 'true')
    expect(window.vellum.askOpen).toHaveBeenCalledTimes(1)
    expect(window.vellum.askOpen).toHaveBeenLastCalledWith({ slug: 'paper-b', sessionId: 2 })
  })
  it('keeps displayed chat and draft until associated paper resolves, then commits both', async () => {
    const { user, chat } = await setup()
    await user.click(chat(1))
    await user.type(screen.getByLabelText('Ask a question'), 'Keep draft')
    const pending = deferred()
    vi.mocked(window.vellum.getPaper).mockReturnValueOnce(pending.promise)
    await user.click(chat(2))
    expect(chat(1)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Ask a question')).toHaveValue('Keep draft')
    expect(window.vellum.askOpen).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(papers[1]))
    expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
    expect(chat(2)).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Ask a question'), 'Question for B')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(window.vellum.askStart).toHaveBeenLastCalledWith({ slug: 'paper-b', chatSessionId: 2, text: 'Question for B' })
    // Direct navigation to another paper must not carry B's durable chat ID.
    await user.click(screen.getByRole('tab', { name: 'Paper A' }))
    expect(window.vellum.askOpen).toHaveBeenLastCalledWith('paper-a')
  })

  for (const navigation of ['paper', 'tab', 'library', 'home', 'trash', 'usage'] as const) {
    it.each(['success', 'missing', 'rejected'] as const)(
      `ignores stale %s after direct ${navigation} navigation`, async (outcome) => {
        const { user, chat } = await setup()
        await user.click(chat(2))
        await user.type(screen.getByLabelText('Ask a question'), 'Preserved draft')
        if (navigation === 'paper') await user.click(screen.getByRole('button', { name: 'Library' }))
        const pending = deferred()
        vi.mocked(window.vellum.getPaper).mockReturnValueOnce(pending.promise)
        await user.click(chat(1))
        if (navigation === 'paper') {
          await user.click(screen.getByText('Paper B', { selector: 'span' }))
        } else if (navigation === 'tab') {
          await user.click(screen.getByRole('tab', { name: 'Paper B' }))
        } else {
          await user.click(screen.getByRole('button', { name: navigation[0].toUpperCase() + navigation.slice(1) }))
        }
        await act(async () => {
          if (outcome === 'rejected') pending.reject(new Error('lookup failed'))
          else pending.resolve(outcome === 'missing' ? null : papers[0])
        })
        expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByRole('tab', { name: 'Paper A' })).not.toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByLabelText('Ask a question')).toHaveValue('Preserved draft')
        expect(window.vellum.askOpen).toHaveBeenCalledTimes(1)
        if (navigation === 'library') expect(screen.getByLabelText(/search papers by title/i)).toBeInTheDocument()
        if (navigation === 'trash') expect(screen.getByRole('region', { name: 'Trash view' })).toBeInTheDocument()
        if (navigation === 'usage') expect(screen.getByRole('region', { name: /usage and telemetry view/i })).toBeInTheDocument()
      },
    )
  }

  it.each(['missing', 'rejected'] as const)('preserves latest missing-paper banner after stale %s', async (outcome) => {
    const { user, chat } = await setup()
    const a = deferred(), b = deferred()
    vi.mocked(window.vellum.getPaper).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await user.click(chat(1))
    await user.click(chat(2))
    await act(async () => b.resolve(null))
    expect(screen.getByRole('alert')).toHaveTextContent('Chat "Chat 2" references paper "paper-b"')
    await act(async () => outcome === 'missing' ? a.resolve(null) : a.reject(new Error('stale failure')))
    expect(screen.getByRole('alert')).toHaveTextContent('Chat "Chat 2" references paper "paper-b"')
    expect(window.vellum.askOpen).not.toHaveBeenCalled()
  })

  it.each(['missing', 'rejected'] as const)('shows current %s error without changing displayed chat; retry recovers', async (outcome) => {
    const { user, chat } = await setup()
    await user.click(chat(2))
    await user.type(screen.getByLabelText('Ask a question'), 'Preserved draft')
    const pending = deferred()
    vi.mocked(window.vellum.getPaper).mockReturnValueOnce(pending.promise)
    await user.click(chat(1))
    await act(async () => outcome === 'missing' ? pending.resolve(null) : pending.reject(new Error('current failure')))
    expect(screen.getByRole('alert')).toHaveTextContent(outcome === 'missing' ? 'was not found in your library' : 'Could not load paper for chat "Chat 1"')
    expect(chat(2)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Ask a question')).toHaveValue('Preserved draft')
    await user.click(chat(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Paper A' })).toHaveAttribute('aria-selected', 'true')
    expect(window.vellum.askOpen).toHaveBeenLastCalledWith({ slug: 'paper-a', sessionId: 1 })
  })

  it.each(['missing', 'rejected'] as const)('can dismiss current %s error by keyboard without losing the displayed draft, then retry', async (outcome) => {
    const { user, chat } = await setup()
    await user.click(chat(2))
    await user.type(screen.getByLabelText('Ask a question'), 'Preserved draft')
    const pending = deferred()
    vi.mocked(window.vellum.getPaper).mockReturnValueOnce(pending.promise)
    await user.click(chat(1))
    await act(async () => outcome === 'missing' ? pending.resolve(null) : pending.reject(new Error('current failure')))

    const dismiss = screen.getByRole('button', { name: 'Dismiss chat navigation error' })
    // Follow the actual focus order from the failed chat selection.
    for (let i = 0; i < 40 && document.activeElement !== dismiss; i++) await user.tab()
    expect(dismiss).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(chat(2)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Ask a question')).toHaveValue('Preserved draft')
    expect(window.vellum.askOpen).toHaveBeenCalledTimes(1)

    await user.click(chat(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(chat(1)).toHaveAttribute('aria-selected', 'true')
    expect(window.vellum.askOpen).toHaveBeenLastCalledWith({ slug: 'paper-a', sessionId: 1 })
  })

  it.each(['success', 'missing', 'rejected'] as const)('does not resurrect deleted pending target on %s', async (outcome) => {
    const { user, chat } = await setup()
    await user.click(chat(2))
    await user.type(screen.getByLabelText('Ask a question'), 'Preserved draft')
    const pending = deferred()
    vi.mocked(window.vellum.getPaper).mockReturnValueOnce(pending.promise)
    await user.click(chat(1))
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(window.vellum.chatListSessions).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Delete chat Chat 1' }))
    await act(async () => outcome === 'rejected' ? pending.reject(new Error('deleted lookup')) : pending.resolve(outcome === 'missing' ? null : papers[0]))
    expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Paper A' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ask a question')).toHaveValue('Preserved draft')
    expect(window.vellum.askOpen).toHaveBeenCalledTimes(1)
  })

})
