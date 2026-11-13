// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IngestModal } from './IngestModal'

let ingestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  ingestMock = vi.fn().mockResolvedValue({
    slug: 'arxiv-1706.03762',
    title: 'Attention Is All You Need',
    metadata: {
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani'],
    },
    paths: {
      pdfPath: 'data/papers/arxiv-1706.03762/paper.pdf',
      mdPath: 'data/papers/arxiv-1706.03762/paper.md',
    },
  })

  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: { ingest: ingestMock },
  })
})

afterEach(() => {
  cleanup()
})

describe('IngestModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <IngestModal isOpen={false} onClose={vi.fn()} onSuccess={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders modal dialog when isOpen is true', () => {
    render(<IngestModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /add paper/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/1706\.03762/)).toBeInTheDocument()
  })

  it('calls onClose when cancel or close button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(<IngestModal isOpen={true} onClose={onClose} onSuccess={vi.fn()} />)

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)
    expect(onClose).toHaveBeenCalledTimes(1)

    const closeBtn = screen.getByRole('button', { name: /close/i })
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('submits valid input, calls window.vellum.ingest, and triggers onSuccess', async () => {
    const onSuccess = vi.fn()
    const user = userEvent.setup()

    render(<IngestModal isOpen={true} onClose={vi.fn()} onSuccess={onSuccess} />)

    const input = screen.getByPlaceholderText(/1706\.03762/)
    await user.type(input, '1706.03762')

    const submitButton = screen.getByRole('button', { name: /add paper/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(ingestMock).toHaveBeenCalledWith('1706.03762')
      expect(onSuccess).toHaveBeenCalledWith({
        slug: 'arxiv-1706.03762',
        title: 'Attention Is All You Need',
      })
    })
  })

  it('shows error message if ingest fails', async () => {
    ingestMock.mockRejectedValue(new Error('Failed to fetch from arXiv'))
    const user = userEvent.setup()

    render(<IngestModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const input = screen.getByPlaceholderText(/1706\.03762/)
    await user.type(input, 'bad-id')

    const submitButton = screen.getByRole('button', { name: /add paper/i })
    await user.click(submitButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch from arXiv')
  })

  it('starts clean when reopened after a failed attempt', async () => {
    ingestMock.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    const { rerender } = render(<IngestModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/1706\.03762/), 'bad-id')
    await user.click(screen.getByRole('button', { name: /add paper/i }))
    await screen.findByRole('alert')

    rerender(<IngestModal isOpen={false} onClose={vi.fn()} onSuccess={vi.fn()} />)
    rerender(<IngestModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByPlaceholderText(/1706\.03762/)).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('strips Electron IPC wrapper noise from ingest errors', async () => {
    ingestMock.mockRejectedValue(
      new Error("Error invoking remote method 'vellum:ingest': Error: classifyInput: local PDF not found: /x.pdf"),
    )
    const user = userEvent.setup()
    render(<IngestModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/1706\.03762/), '/x.pdf')
    await user.click(screen.getByRole('button', { name: /add paper/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Local PDF not found: \/x\.pdf$/)
  })
})
