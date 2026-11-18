// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrashView } from './TrashView.js'
import type { PaperRecord } from '../../core/library/repo.js'

describe('TrashView [L2-04]', () => {
  let listPapers: ReturnType<typeof vi.fn>
  let paperRestore: ReturnType<typeof vi.fn>
  let paperPurge: ReturnType<typeof vi.fn>

  const mockPapers: PaperRecord[] = [
    {
      slug: 'trashed-1',
      title: 'Attention Is All You Need',
      authors: ['Vaswani', 'Shazeer'],
      addedAt: '2026-01-01',
      trashedAt: '2026-02-01T12:00:00.000Z',
    },
    {
      slug: 'trashed-2',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers',
      authors: ['Devlin'],
      addedAt: '2026-01-02',
      trashedAt: '2026-02-02T12:00:00.000Z',
    },
  ]

  beforeEach(() => {
    listPapers = vi.fn().mockResolvedValue(mockPapers)
    paperRestore = vi.fn().mockResolvedValue({ ...mockPapers[0], trashedAt: null })
    paperPurge = vi.fn().mockResolvedValue(true)

    Object.defineProperty(window, 'vellum', {
      configurable: true,
      value: { listPapers, paperRestore, paperPurge },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders loading state, then loads and lists trashed papers', async () => {
    render(<TrashView />)
    expect(screen.getByText(/loading trash/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument()
      expect(screen.getByText(/BERT: Pre-training/)).toBeInTheDocument()
    })

    expect(listPapers).toHaveBeenCalledWith({ trashed: true })
  })

  it('renders empty state when there are no trashed papers', async () => {
    listPapers.mockResolvedValueOnce([])
    render(<TrashView />)

    await waitFor(() => {
      expect(screen.getByText(/trash is empty/i)).toBeInTheDocument()
    })
  })

  it('restores a paper when Restore button is clicked', async () => {
    const onRestored = vi.fn()
    render(<TrashView onPaperRestored={onRestored} />)

    const restoreBtn = await screen.findByRole('button', { name: 'Restore Attention Is All You Need' })
    fireEvent.click(restoreBtn)

    await waitFor(() => {
      expect(paperRestore).toHaveBeenCalledWith('trashed-1')
      expect(onRestored).toHaveBeenCalledWith('trashed-1')
      expect(screen.queryByText('Attention Is All You Need')).not.toBeInTheDocument()
    })
  })

  it('opens confirmation modal and cancels purge when Cancel is clicked', async () => {
    render(<TrashView />)

    const purgeBtn = await screen.findByRole('button', { name: 'Delete Attention Is All You Need permanently' })
    fireEvent.click(purgeBtn)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/This action cannot be undone/i)).toBeInTheDocument()

    const cancelBtn = screen.getByRole('button', { name: 'Cancel purge' })
    fireEvent.click(cancelBtn)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(paperPurge).not.toHaveBeenCalled()
  })

  it('closes the purge confirmation when Escape is pressed', async () => {
    render(<TrashView />)

    const purgeBtn = await screen.findByRole('button', { name: 'Delete Attention Is All You Need permanently' })
    fireEvent.click(purgeBtn)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(purgeBtn, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(paperPurge).not.toHaveBeenCalled()
  })

  it('keeps the purge confirmation open on Escape while the purge is running', async () => {
    paperPurge.mockReturnValue(new Promise(() => undefined))
    render(<TrashView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Attention Is All You Need permanently' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm purge' }))
    expect(await screen.findByText('Deleting…')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('permanently purges paper when confirmed in modal', async () => {
    render(<TrashView />)

    const purgeBtn = await screen.findByRole('button', { name: 'Delete Attention Is All You Need permanently' })
    fireEvent.click(purgeBtn)

    const confirmBtn = screen.getByRole('button', { name: 'Confirm purge' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(paperPurge).toHaveBeenCalledWith('trashed-1')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('Attention Is All You Need')).not.toBeInTheDocument()
    })
  })

  it('displays actionable error banner if restore or purge fails', async () => {
    paperRestore.mockRejectedValueOnce(new Error('Database write failure'))
    render(<TrashView />)

    const restoreBtn = await screen.findByRole('button', { name: 'Restore Attention Is All You Need' })
    fireEvent.click(restoreBtn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Database write failure')
    })
  })

  it('shows the friendly refusal, without IPC wrapper text, when purge is refused during an answer', async () => {
    paperPurge.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'vellum:paper-purge': Error: This paper has an answer in progress. Wait for it to finish, then delete it permanently.",
    ))
    render(<TrashView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Attention Is All You Need permanently' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm purge' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This paper has an answer in progress. Wait for it to finish, then delete it permanently.')
    expect(alert).not.toHaveTextContent(/Error invoking|SQLITE/)
    expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument()
  })

  it.each([
    ['load', () => listPapers.mockRejectedValueOnce(new Error("Error invoking remote method 'vellum:list-papers': Error: database is locked"))],
    ['restore', () => paperRestore.mockRejectedValueOnce(new Error("Error invoking remote method 'vellum:paper-restore': Error: restorePaper: database is locked"))],
    ['purge', () => paperPurge.mockRejectedValueOnce(new Error("Error invoking remote method 'vellum:paper-purge': Error: purgePaper: database is locked"))],
  ] as const)('shows %s failures without Electron IPC noise', async (action, fail) => {
    fail()
    render(<TrashView />)
    if (action === 'restore') {
      fireEvent.click(await screen.findByRole('button', { name: 'Restore Attention Is All You Need' }))
    } else if (action === 'purge') {
      fireEvent.click(await screen.findByRole('button', { name: 'Delete Attention Is All You Need permanently' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirm purge' }))
    }
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/invoking remote method|Error:|restorePaper|purgePaper/)
    expect(alert.textContent).toMatch(/database is locked/i)
  })
})
