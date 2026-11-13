// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IngestModal } from './IngestModal'

let ingestMock: ReturnType<typeof vi.fn>
let getPathForFileMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  getPathForFileMock = vi.fn().mockReturnValue('/home/research/Papers/注意 Attention.pdf')
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
    value: { ingest: ingestMock, getPathForFile: getPathForFileMock },
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
})

describe('local PDF selection', () => {
  it('submits the full disk path including spaces and Unicode', async () => {
    const user = userEvent.setup()
    const { container } = render(<IngestModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />)
    const file = new File(['pdf'], 'Attention.pdf', { type: 'application/pdf' })
    await user.upload(container.querySelector('input[type="file"]')!, file)
    expect(getPathForFileMock).toHaveBeenCalledWith(file)
    expect(screen.getByLabelText('Paper identifier or URL')).toHaveValue('/home/research/Papers/注意 Attention.pdf')
    await user.click(screen.getByRole('button', { name: 'Add Paper' }))
    expect(ingestMock).toHaveBeenCalledWith('/home/research/Papers/注意 Attention.pdf')
  })
})

describe('unavailable PDF paths', () => {
  it.each(['empty', 'throws', 'missing method', 'missing bridge'])('clears stale input, blocks submission and permits retry when resolver is %s', async (failure) => {
    const user = userEvent.setup()
    const { container } = render(<IngestModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />)
    const input = screen.getByLabelText('Paper identifier or URL')
    await user.type(input, '/previous/paper.pdf')
    if (failure === 'empty') getPathForFileMock.mockReturnValueOnce('')
    if (failure === 'throws') getPathForFileMock.mockImplementationOnce(() => { throw new Error('native failure') })
    if (failure === 'missing method') Object.defineProperty(window, 'vellum', { configurable: true, value: { ingest: ingestMock } })
    if (failure === 'missing bridge') Object.defineProperty(window, 'vellum', { configurable: true, value: undefined })
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['pdf'], 'Attention.pdf', { type: 'application/pdf' })
    await user.upload(fileInput, file)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not access.*choose.*again.*enter.*path/i)
    expect(input).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add Paper' })).toBeDisabled()
    expect(ingestMock).not.toHaveBeenCalled()
    expect(fileInput.value).toBe('')
    Object.defineProperty(window, 'vellum', { configurable: true, value: { ingest: ingestMock, getPathForFile: getPathForFileMock } })
    await user.upload(fileInput, file)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add Paper' }))
    expect(ingestMock).toHaveBeenCalledWith('/home/research/Papers/注意 Attention.pdf')
  })

  it('preserves manual input when file selection is cancelled', async () => {
    const user = userEvent.setup()
    const { container } = render(<IngestModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('Paper identifier or URL'), 'https://example.org/paper.pdf')
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [] } })
    expect(getPathForFileMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Add Paper' }))
    expect(ingestMock).toHaveBeenCalledWith('https://example.org/paper.pdf')
  })
})


describe('manual import', () => {
  it.each(['10.1145/3318464.3389700', '/home/research/注意 paper.pdf'])('preserves typed input %s without resolving a File', async (target) => {
    const user = userEvent.setup()
    render(<IngestModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('Paper identifier or URL'), target)
    await user.click(screen.getByRole('button', { name: 'Add Paper' }))
    expect(ingestMock).toHaveBeenCalledWith(target)
    expect(getPathForFileMock).not.toHaveBeenCalled()
  })
})
