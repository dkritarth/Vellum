// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskPanel } from './AskPanel'

type UpdateListener = (payload: { requestId: string; event: unknown }) => void

let askOpen: ReturnType<typeof vi.fn>
let askNewChat: ReturnType<typeof vi.fn>
let askStart: ReturnType<typeof vi.fn>
let onAskUpdate: ReturnType<typeof vi.fn>
let updateListeners: UpdateListener[]

function emit(payload: { requestId: string; event: unknown }): void {
  for (const listener of updateListeners) listener(payload)
}

beforeEach(() => {
  updateListeners = []
  askOpen = vi.fn().mockResolvedValue({ session: { id: 1, paperSlug: 'p1', backend: 'claude', title: null, createdAt: 't' }, messages: [] })
  askNewChat = vi.fn().mockResolvedValue({ session: { id: 2, paperSlug: 'p1', backend: 'claude', title: null, createdAt: 't2' }, messages: [] })
  askStart = vi.fn().mockResolvedValue({ requestId: 'req-1' })
  onAskUpdate = vi.fn((listener: UpdateListener) => {
    updateListeners.push(listener)
    return () => {
      updateListeners = updateListeners.filter((l) => l !== listener)
    }
  })

  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: { askOpen, askNewChat, askStart, onAskUpdate },
  })
})

afterEach(() => {
  cleanup()
})

describe('AskPanel', () => {
  it('loads and shows prior history for the open paper', async () => {
    askOpen.mockResolvedValue({
      session: { id: 1, paperSlug: 'p1', backend: 'claude', title: null, createdAt: 't' },
      messages: [
        { id: 1, sessionId: 1, role: 'user', content: 'What is the core contribution?', createdAt: 't' },
        { id: 2, sessionId: 1, role: 'assistant', content: 'The Transformer architecture.', createdAt: 't' },
      ],
    })

    render(<AskPanel slug="p1" />)

    expect(await screen.findByText('What is the core contribution?')).toBeInTheDocument()
    expect(screen.getByText('The Transformer architecture.')).toBeInTheDocument()
    expect(askOpen).toHaveBeenCalledWith('p1')
  })

  it('sends a turn, streams chunks into a growing reply, then finalizes on done', async () => {
    const user = userEvent.setup()
    render(<AskPanel slug="p1" />)

    await waitFor(() => expect(askOpen).toHaveBeenCalled())

    await user.type(screen.getByLabelText(/ask a question/i), 'What is the core contribution?')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText('What is the core contribution?')).toBeInTheDocument()
    await waitFor(() => expect(askStart).toHaveBeenCalledWith({ chatSessionId: 1, slug: 'p1', text: 'What is the core contribution?' }))

    emit({ requestId: 'req-1', event: { kind: 'text', text: 'The core ' } })
    emit({ requestId: 'req-1', event: { kind: 'text', text: 'contribution is the Transformer.' } })

    expect(await screen.findByText('The core contribution is the Transformer.')).toBeInTheDocument()

    emit({
      requestId: 'req-1',
      event: { kind: 'done', message: { id: 5, sessionId: 1, role: 'assistant', content: 'The core contribution is the Transformer.', createdAt: 't' } },
    })

    // Turn settled — input usable again for the next question (Send itself
    // stays disabled until there's text to send, which is expected).
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).not.toBeDisabled())
  })

  it('starts a fresh session on "New chat" and clears the thread', async () => {
    const user = userEvent.setup()
    askOpen.mockResolvedValue({
      session: { id: 1, paperSlug: 'p1', backend: 'claude', title: null, createdAt: 't' },
      messages: [{ id: 1, sessionId: 1, role: 'user', content: 'old question', createdAt: 't' }],
    })

    render(<AskPanel slug="p1" />)
    expect(await screen.findByText('old question')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /new chat/i }))

    await waitFor(() => expect(askNewChat).toHaveBeenCalledWith({ slug: 'p1', backend: 'claude' }))
    expect(screen.queryByText('old question')).not.toBeInTheDocument()
    expect(screen.getByText(/ask a question about this paper/i)).toBeInTheDocument()
  })

  it('switches backend by creating a persisted fresh chat before next turn', async () => {
    const user = userEvent.setup()
    askNewChat.mockResolvedValue({
      session: { id: 2, paperSlug: 'p1', backend: 'codex', title: null, createdAt: 't2' },
      messages: [],
    })
    render(<AskPanel slug="p1" />)

    await waitFor(() => expect(askOpen).toHaveBeenCalled())
    await user.selectOptions(screen.getByLabelText(/model backend/i), 'codex')

    await waitFor(() => expect(askNewChat).toHaveBeenCalledWith({ slug: 'p1', backend: 'codex' }))
    await user.type(screen.getByLabelText(/ask a question/i), 'Summarize this.')
    await user.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() =>
      expect(askStart).toHaveBeenCalledWith({ chatSessionId: 2, slug: 'p1', text: 'Summarize this.' }),
    )
  })

  it('surfaces an error update without crashing the panel', async () => {
    const user = userEvent.setup()
    render(<AskPanel slug="p1" />)
    await waitFor(() => expect(askOpen).toHaveBeenCalled())

    await user.type(screen.getByLabelText(/ask a question/i), 'hello')
    await user.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(askStart).toHaveBeenCalled())

    emit({ requestId: 'req-1', event: { kind: 'error', message: 'ACP adapter not found' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('ACP adapter not found')
    // Panel survives — input is usable again, not stuck mid-turn.
    expect(screen.getByLabelText(/ask a question/i)).not.toBeDisabled()
  })

  it('shows a load error instead of crashing when askOpen rejects', async () => {
    askOpen.mockRejectedValue(new Error('db locked'))

    render(<AskPanel slug="p1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/db locked/i)
  })
})
