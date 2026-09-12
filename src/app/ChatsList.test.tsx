// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatsList } from './ChatsList'
import type { ChatSessionSummary } from '../../core/chat/repo'

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
    } as any
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
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
})
