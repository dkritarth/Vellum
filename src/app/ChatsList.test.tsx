// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatsList } from './ChatsList'
import type { ChatSessionSummary } from '../../core/chat/repo'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ChatsList [L2-02]', () => {
  const mockSessions: ChatSessionSummary[] = [
    {
      id: 1,
      paperSlug: 'attention-is-all-you-need',
      paperTitle: 'Attention Is All You Need',
      backend: 'claude',
      title: 'Explain Transformer architecture',
      preview: 'The Transformer uses self-attention',
      messageCount: 4,
      createdAt: '2026-03-01T10:00:00.000Z',
      lastActiveAt: '2026-03-01T10:05:00.000Z',
    },
    {
      id: 2,
      paperSlug: 'missing-paper-slug',
      paperTitle: null,
      backend: 'codex',
      title: 'Orphaned Chat Discussion',
      preview: 'Testing missing paper',
      messageCount: 1,
      createdAt: '2026-03-01T09:00:00.000Z',
      lastActiveAt: '2026-03-01T09:00:00.000Z',
    },
  ]

  beforeEach(() => {
    window.vellum = {
      ...window.vellum,
      chatListSessions: vi.fn().mockResolvedValue(mockSessions),
      chatDeleteSession: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders chat sessions list with titles, papers, backends, and message counts', async () => {
    const onSelect = vi.fn()
    render(<ChatsList selectedSessionId={null} onSelectSession={onSelect} />)

    expect(await screen.findByText('Explain Transformer architecture')).toBeInTheDocument()
    expect(screen.getByText(/Attention Is All You Need/)).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText('4 turns')).toBeInTheDocument()

    // Missing paper fallback
    expect(screen.getByText('Orphaned Chat Discussion')).toBeInTheDocument()
    expect(screen.getByText(/Paper not in library/)).toBeInTheDocument()
    expect(screen.getByText('codex')).toBeInTheDocument()
  })

  it('invokes onSelectSession when clicking a session item', async () => {
    const onSelect = vi.fn()
    render(<ChatsList selectedSessionId={null} onSelectSession={onSelect} />)

    const item = await screen.findByText('Explain Transformer architecture')
    fireEvent.click(item)

    expect(onSelect).toHaveBeenCalledWith(mockSessions[0])
  })

  it('supports keyboard navigation with Arrow keys and Enter', async () => {
    const onSelect = vi.fn()
    render(<ChatsList selectedSessionId={null} onSelectSession={onSelect} />)

    await screen.findByText('Explain Transformer architecture')
    const container = screen.getByRole('listbox')

    fireEvent.keyDown(container, { key: 'ArrowDown' })
    fireEvent.keyDown(container, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(mockSessions[0])
  })

  it('deletes a chat session when the delete action is confirmed', async () => {
    const onSelect = vi.fn()
    render(<ChatsList selectedSessionId={null} onSelectSession={onSelect} />)

    await screen.findByText('Explain Transformer architecture')
    const deleteBtn = screen.getByRole('button', { name: 'Delete chat Explain Transformer architecture' })
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled()
      expect(window.vellum.chatDeleteSession).toHaveBeenCalledWith(1)
    })
  })

  it('filters sessions by search input', async () => {
    const onSelect = vi.fn()
    render(<ChatsList selectedSessionId={null} onSelectSession={onSelect} />)

    await screen.findByText('Explain Transformer architecture')
    const searchInput = screen.getByRole('searchbox', { name: 'Search chats' })
    fireEvent.change(searchInput, { target: { value: 'Transformer' } })

    await waitFor(() => {
      expect(window.vellum.chatListSessions).toHaveBeenCalledWith({ search: 'Transformer' })
    })
  })

  it('keeps the current search results when an older query succeeds late', async () => {
    const old = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([mockSessions[1]])
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Orphaned' } })
    await screen.findByText('Orphaned Chat Discussion')
    await act(async () => old.resolve([mockSessions[0]]))
    expect(screen.getByRole('searchbox')).toHaveValue('Orphaned')
    expect(screen.getByText('Orphaned Chat Discussion')).toBeVisible()
    expect(screen.queryByText('Explain Transformer architecture')).not.toBeInTheDocument()
  })

  it.each(['success', 'error'] as const)('ignores obsolete %s while the current query is loading', async (outcome) => {
    const old = deferred<ChatSessionSummary[]>()
    const current = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } })
    await act(async () => {
      if (outcome === 'success') old.resolve([])
      else old.reject(new Error('obsolete error'))
    })
    expect(screen.getByText('Loading chats…')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => current.resolve([]))
    expect(screen.getByText('No chats matching "new"')).toBeVisible()
  })

  it('clears the previous query error and results while the new query loads', async () => {
    const current = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockRejectedValueOnce(new Error('current failure'))
      .mockReturnValueOnce(current.promise)
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('current failure')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Orphaned' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Loading chats…')).toBeVisible()
    await act(async () => current.resolve([mockSessions[1]]))
    const next = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions).mockReturnValueOnce(next.promise)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText('Loading chats…')).toBeVisible()
    await act(async () => next.resolve([]))
    expect(screen.getByText('No chats matching "missing"')).toBeVisible()
  })

  it.each(['success', 'error'] as const)('ignores an older poll %s after a newer poll succeeds', async (outcome) => {
    vi.useFakeTimers()
    const old = deferred<ChatSessionSummary[]>()
    const newer = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockResolvedValueOnce([mockSessions[0]])
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise)
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    await act(async () => {})
    await act(async () => vi.advanceTimersByTime(4000))
    await act(async () => newer.resolve([mockSessions[1]]))
    await act(async () => {
      if (outcome === 'success') old.resolve([mockSessions[0]])
      else old.reject(new Error('obsolete poll'))
    })
    expect(screen.getByText('Orphaned Chat Discussion')).toBeVisible()
    expect(screen.queryByText('Explain Transformer architecture')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves a newer error against old success and recovers on the next poll', async () => {
    vi.useFakeTimers()
    const old = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('latest failure'))
      .mockResolvedValueOnce([mockSessions[1]])
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    await act(async () => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('alert')).toHaveTextContent('latest failure')
    await act(async () => old.resolve([mockSessions[0]]))
    expect(screen.getByRole('alert')).toHaveTextContent('latest failure')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Orphaned Chat Discussion')).toBeVisible()
  })

  it('refreshes the current search after a pending deletion and notifies once', async () => {
    const deletion = deferred<void>()
    const onDeleted = vi.fn()
    vi.mocked(window.vellum.chatDeleteSession).mockReturnValueOnce(deletion.promise)
    vi.mocked(window.vellum.chatListSessions).mockImplementation(async (options) =>
      options?.search === 'Orphaned' ? [mockSessions[1]] : mockSessions)
    render(<ChatsList selectedSessionId={1} onSelectSession={vi.fn()} onSessionDeleted={onDeleted} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete chat Explain Transformer architecture' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Orphaned' } })
    await screen.findByText('Orphaned Chat Discussion')
    await act(async () => deletion.resolve())
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledWith(1)
    expect(window.vellum.chatListSessions).toHaveBeenLastCalledWith({ search: 'Orphaned' })
    expect(screen.getByText('Orphaned Chat Discussion')).toBeVisible()
    expect(screen.queryByText('Explain Transformer architecture')).not.toBeInTheDocument()
  })

  it('ignores an old query even when the same search is requested again', async () => {
    const old = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockSessions[1]])
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'other' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    await screen.findByText('Orphaned Chat Discussion')
    await act(async () => old.resolve([mockSessions[0]]))
    expect(screen.getByText('Orphaned Chat Discussion')).toBeVisible()
    expect(screen.queryByText('Explain Transformer architecture')).not.toBeInTheDocument()
  })

  it.each(['success', 'error'] as const)('invalidates unmounted requests and polls before remount (%s)', async (outcome) => {
    vi.useFakeTimers()
    const old = deferred<ChatSessionSummary[]>()
    vi.mocked(window.vellum.chatListSessions)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([mockSessions[1]])
    const first = render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    first.unmount()
    await act(async () => vi.advanceTimersByTime(4000))
    expect(window.vellum.chatListSessions).toHaveBeenCalledTimes(1)
    render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} />)
    await act(async () => {})
    await act(async () => {
      if (outcome === 'success') old.resolve([mockSessions[0]])
      else old.reject(new Error('unmounted error'))
    })
    expect(screen.getByText('Orphaned Chat Discussion')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not refresh an unmounted list after deletion completes', async () => {
    const deletion = deferred<void>()
    vi.mocked(window.vellum.chatDeleteSession).mockReturnValueOnce(deletion.promise)
    const onDeleted = vi.fn()
    const view = render(<ChatsList selectedSessionId={null} onSelectSession={vi.fn()} onSessionDeleted={onDeleted} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete chat Explain Transformer architecture' }))
    view.unmount()
    await act(async () => deletion.resolve())
    expect(window.vellum.chatListSessions).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledWith(1)
  })
})
