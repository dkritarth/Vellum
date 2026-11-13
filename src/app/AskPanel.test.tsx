// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    value: { askOpen, askNewChat, askStart, onAskUpdate, questionsGet: vi.fn().mockResolvedValue([]), questionsRegenerate: vi.fn().mockResolvedValue([]) },
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

  it.each([
    { slug: 'p2', targetSessionId: undefined },
    { slug: 'p1', targetSessionId: 2 },
  ])('unlocks the destination chat and ignores outgoing completion on switch to $slug/$targetSessionId', async (destination) => {
    const user = userEvent.setup()
    const { rerender } = render(<AskPanel slug="p1" />)
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    await user.type(screen.getByLabelText(/ask a question/i), 'Outgoing question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()

    askOpen.mockResolvedValue({
      session: { id: 2, paperSlug: destination.slug, backend: 'codex' },
      messages: [{ id: 20, role: 'assistant', content: 'Destination history' }],
    })
    rerender(<AskPanel {...destination} />)
    expect(await screen.findByText('Destination history')).toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
    expect(screen.getByRole('button', { name: /new chat/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Sending…' })).not.toBeInTheDocument()

    await act(async () => {
      emit({ requestId: 'req-1', event: { kind: 'text', text: 'Outgoing partial answer' } })
      emit({ requestId: 'req-1', event: {
        kind: 'done', message: { id: 5, role: 'assistant', content: 'Outgoing final answer' },
      } })
    })
    expect(screen.queryByText(/Outgoing/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/ask a question/i), 'Destination question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(askStart).toHaveBeenLastCalledWith({ chatSessionId: 2, slug: destination.slug, text: 'Destination question' })
  })

  it('submits only once while request acknowledgement is pending', async () => {
    askStart.mockReturnValueOnce(new Promise(() => {}))
    const user = userEvent.setup()
    render(<AskPanel slug="p1" />)
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    await user.type(screen.getByLabelText(/ask a question/i), 'One question')
    const form = screen.getByLabelText(/ask a question/i).closest('form')!
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(askStart).toHaveBeenCalledTimes(1)
  })

  it('settles events emitted before askStart acknowledges the request', async () => {
    let resolveStart!: (result: { requestId: string }) => void
    askStart.mockReturnValueOnce(new Promise((resolve) => { resolveStart = resolve }))
    const user = userEvent.setup()
    render(<AskPanel slug="p1" />)
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    await user.type(screen.getByLabelText(/ask a question/i), 'Fast question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {
      emit({ requestId: 'fast', event: { kind: 'done', sequence: 1, message: { id: 2, role: 'assistant', content: 'Fast answer' } } })
      resolveStart({ requestId: 'fast' })
    })
    expect(await screen.findByText('Fast answer')).toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
  })

  it('keeps another chat on the same paper locked without mixing its active answer into history', async () => {
    askOpen.mockResolvedValue({
      session: { id: 2, paperSlug: 'p1', backend: 'codex' },
      messages: [{ id: 1, role: 'assistant', content: 'Older conversation' }],
      activeTurn: { requestId: 'other-chat', chatSessionId: 1, text: 'Other chat partial', sequence: 1 },
    })
    render(<AskPanel slug="p1" targetSessionId={2} />)
    expect(await screen.findByText('Older conversation')).toBeInTheDocument()
    expect(screen.queryByText('Other chat partial')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled()
    await act(async () => emit({ requestId: 'other-chat', event: { kind: 'done', sequence: 2, message: { id: 2, role: 'assistant', content: 'Other chat final' } } }))
    expect(screen.queryByText('Other chat final')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
  })

  it('replays updates received while an active-turn snapshot is loading without duplicating text', async () => {
    let resolveOpen!: (result: unknown) => void
    askOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    render(<AskPanel slug="p1" />)
    await act(async () => {
      emit({ requestId: 'restored', event: { kind: 'text', text: 'First', sequence: 1 } })
      emit({ requestId: 'restored', event: { kind: 'text', text: ' second', sequence: 2 } })
      resolveOpen({
        session: { id: 1, paperSlug: 'p1', backend: 'codex' },
        messages: [{ id: 1, role: 'user', content: 'Question' }],
        activeTurn: { requestId: 'restored', chatSessionId: 1, text: 'First', sequence: 1 },
      })
    })
    expect(await screen.findByText('First second')).toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled()
    await act(async () => emit({ requestId: 'restored', event: { kind: 'done', sequence: 3, message: { id: 2, role: 'assistant', content: 'Completed' } } }))
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
  })

  it('settles a turn that finishes before the open snapshot resolves', async () => {
    let resolveOpen!: (result: unknown) => void
    askOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    render(<AskPanel slug="p1" />)
    await act(async () => {
      emit({ requestId: 'restored', event: { kind: 'done', sequence: 2, message: { id: 2, role: 'assistant', content: 'Completed' } } })
      resolveOpen({ session: { id: 1, paperSlug: 'p1', backend: 'codex' }, messages: [], activeTurn: { requestId: 'restored', chatSessionId: 1, text: '', sequence: 1 } })
    })
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
  })

  it.each(['paper return', 'tab remount'])('restores the authoritative active turn after %s', async (navigation) => {
    const user = userEvent.setup()
    const view = render(<AskPanel slug="p1" />)
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    await user.type(screen.getByLabelText(/ask a question/i), 'First question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    if (navigation === 'paper return') {
      askOpen.mockResolvedValue({ session: { id: 2, paperSlug: 'p2', backend: 'codex' }, messages: [], activeTurn: null })
      view.rerender(<AskPanel slug="p2" />)
      await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    } else view.unmount()
    askOpen.mockResolvedValue({
      session: { id: 1, paperSlug: 'p1', backend: 'claude' },
      messages: [{ id: 10, role: 'user', content: 'First question' }],
      activeTurn: { requestId: 'req-1', chatSessionId: 1, text: 'Restored partial' },
    })
    if (navigation === 'paper return') view.rerender(<AskPanel slug="p1" />)
    else render(<AskPanel slug="p1" />)
    expect(await screen.findByText('First question')).toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /new chat/i })).toBeDisabled()
    expect(screen.getByText('Restored partial')).toBeInTheDocument()
    fireEvent.submit(screen.getByLabelText(/ask a question/i).closest('form')!)
    expect(askStart).toHaveBeenCalledTimes(1)
    await act(async () => {
      emit({ requestId: 'req-1', event: { kind: 'done', message: { id: 11, role: 'assistant', content: 'Final answer' } } })
    })
    expect(screen.getByText('Final answer')).toBeInTheDocument()
    expect(screen.queryByText('Restored partial')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
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

  it.each(['resolve', 'reject'] as const)('ignores an outgoing askStart that finishes late (%s)', async (outcome) => {
    let resolveStart!: (value: { requestId: string }) => void
    let rejectStart!: (error: Error) => void
    askStart.mockReturnValueOnce(new Promise((resolve, reject) => {
      resolveStart = resolve
      rejectStart = reject
    }))
    const user = userEvent.setup()
    const { rerender } = render(<AskPanel slug="p1" />)
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    await user.type(screen.getByLabelText(/ask a question/i), 'Outgoing question')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    askOpen.mockResolvedValue({ session: { id: 2, paperSlug: 'p2', backend: 'codex' }, messages: [] })
    rerender(<AskPanel slug="p2" />)
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled())
    askStart.mockResolvedValue({ requestId: 'req-destination' })
    await user.type(screen.getByLabelText(/ask a question/i), 'Destination question')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await act(async () => {
      if (outcome === 'reject') rejectStart(new Error('Outgoing start failure'))
      else resolveStart({ requestId: 'req-outgoing' })
    })
    await act(async () => {
      emit({ requestId: 'req-outgoing', event: { kind: 'done', message: {
        id: 10, role: 'assistant', content: 'Outgoing final answer',
      } } })
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Outgoing final answer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()

    await act(async () => {
      emit({ requestId: 'req-destination', event: { kind: 'done', message: {
        id: 20, role: 'assistant', content: 'Destination final answer',
      } } })
    })
    expect(screen.getByText('Destination final answer')).toBeInTheDocument()
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
  })

  it('sends a canned quick-action prompt into the Ask thread', async () => {
    const user = userEvent.setup()
    render(<AskPanel slug="p1" />)
    await waitFor(() => expect(askOpen).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Breakdown' }))
    await waitFor(() => expect(askStart).toHaveBeenCalledWith(expect.objectContaining({ chatSessionId: 1, slug: 'p1', text: expect.stringMatching(/Break down/) })))
  })

  it.each(['resolve', 'reject'] as const)('ignores an outgoing New chat that finishes late (%s)', async (outcome) => {
    let resolveChat!: (result: unknown) => void
    let rejectChat!: (error: Error) => void
    askNewChat.mockReturnValueOnce(new Promise((resolve, reject) => {
      resolveChat = resolve
      rejectChat = reject
    }))
    const user = userEvent.setup()
    const { rerender } = render(<AskPanel slug="p1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /new chat/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /new chat/i }))

    askOpen.mockResolvedValue({
      session: { id: 2, paperSlug: 'p2', backend: 'codex' },
      messages: [{ id: 20, role: 'assistant', content: 'Destination history' }],
    })
    rerender(<AskPanel slug="p2" />)
    await screen.findByText('Destination history')
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
    await act(async () => {
      if (outcome === 'reject') rejectChat(new Error('Outgoing New chat failure'))
      else resolveChat({ session: { id: 3, paperSlug: 'p1', backend: 'claude' }, messages: [] })
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Destination history')).toBeInTheDocument()
    expect(screen.getByLabelText(/model backend/i)).toHaveValue('codex')
    await user.type(screen.getByLabelText(/ask a question/i), 'Destination question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(askStart).toHaveBeenLastCalledWith({ chatSessionId: 2, slug: 'p2', text: 'Destination question' })
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

  it('pre-populates input when injectedPrompt has autoSend false [R1-05]', async () => {
    render(
      <AskPanel
        slug="p1"
        injectedPrompt={{ text: '> "Attention is all you need" (p. 1)', autoSend: false, nonce: 1 }}
      />,
    )
    await waitFor(() => expect(askOpen).toHaveBeenCalled())
    const input = await screen.findByLabelText(/ask a question/i)
    await waitFor(() => expect(input).toHaveValue('> "Attention is all you need" (p. 1)'))
  })

  it('automatically triggers askStart when injectedPrompt has autoSend true [R1-05]', async () => {
    render(
      <AskPanel
        slug="p1"
        injectedPrompt={{ text: 'Explain this passage: "Transformer"', autoSend: true, nonce: 2 }}
      />,
    )
    await waitFor(() => expect(askOpen).toHaveBeenCalled())
    await waitFor(() =>
      expect(askStart).toHaveBeenCalledWith({
        chatSessionId: 1,
        slug: 'p1',
        text: 'Explain this passage: "Transformer"',
      }),
    )
  })
  it('reopens exact chat session when targetSessionId is passed [L2-02]', async () => {
    askOpen.mockResolvedValue({
      session: { id: 42, paperSlug: 'p1', backend: 'claude', title: 'Prior Discussion', createdAt: 't' },
      messages: [
        { id: 10, sessionId: 42, role: 'user', content: 'Target session question', createdAt: 't' },
      ],
    })

    render(<AskPanel slug="p1" targetSessionId={42} />)

    expect(await screen.findByText('Target session question')).toBeInTheDocument()
    expect(askOpen).toHaveBeenCalledWith({ slug: 'p1', sessionId: 42 })
  })
  it('starts an Ask turn when clicking a suggested question chip [L2-03]', async () => {
    const mockQuestions = [
      { id: 1, paperSlug: 'p1', backend: 'claude', question: 'How does attention scale with sequence length?', category: 'methodology', createdAt: 't' }
    ]
    window.vellum.questionsGet = vi.fn().mockResolvedValue(mockQuestions)

    render(<AskPanel slug="p1" />)

    const chip = await screen.findByText('How does attention scale with sequence length?')
    fireEvent.click(chip)

    await waitFor(() => {
      expect(askStart).toHaveBeenCalledWith({
        chatSessionId: 1,
        slug: 'p1',
        text: 'How does attention scale with sequence length?',
      })
    })
  })
})
