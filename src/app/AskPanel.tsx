import { SuggestedQuestions } from './SuggestedQuestions'
// AskPanel — [P1-10] grounded chat over ACP. Mounted in RightPanel's Ask tab
// once a paper is open (bound to its slug). Talks only to `window.vellum`
// (preload bridge) — never imports Node/core directly, per AGENTS.md.
//
// Flow:
//   1. On mount / slug change: `askOpen(slug)` reloads the most recent chat
//      session + its persisted history (electron/main.ts's `vellum:ask-open`).
//   2. Sending a turn: optimistically appends the user's message, then
//      `askStart(...)` kicks off the turn and returns a `requestId`
//      immediately (the turn itself streams). `onAskUpdate` is subscribed
//      once for the panel's lifetime and routes events by that id — text
//      chunks append to a growing assistant bubble, `done` swaps it for the
//      persisted message, `error` surfaces inline without losing the thread.
//   3. "New chat": `askNewChat(slug)` starts a fresh session + fresh agent
//      conversation (main process disposes the cached ACP session).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AskUpdatePayload } from '../../electron/preload'
import { ModelSelector } from './ModelSelector'
import type { ChatBackend } from './ModelSelector'
import { QuickActions } from './QuickActions'
import styles from './AskPanel.module.css'

type Role = 'user' | 'assistant'

interface DisplayMessage {
  /** Numeric = a persisted chat_messages.id. String = a client-local,
   * not-yet-persisted placeholder (the optimistic user echo, or the
   * in-progress streaming assistant bubble). */
  id: number | string
  role: Role
  content: string
}

const STREAMING_ID = 'streaming-reply'

export interface InjectedPrompt {
  text: string
  autoSend?: boolean
  nonce: number
}

interface AskPanelProps {
  /** Slug of the currently open paper — the chat is scoped to it. */
  slug: string
  /** [R1-05] Contextual prompt injected from PDF text selection (Add to chat or Explain) */
  injectedPrompt?: InjectedPrompt | null
  /** [L2-02] Target chat session ID to restore from Chats library */
  targetSessionId?: number | null
}

export function AskPanel({ slug, injectedPrompt, targetSessionId }: AskPanelProps): JSX.Element {
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [backend, setBackend] = useState<ChatBackend>('claude')
  const [switchingSession, setSwitchingSession] = useState(false)
  const activeRequestId = useRef<string | null>(null)
  const activeTurnSessionId = useRef<number | null>(null)
  const displayedSessionId = useRef<number | null>(null)
  // Async starts can settle after navigation. They may only update the
  // paper/session generation that initiated them.
  const contextGeneration = useRef(0)
  const awaitingRequest = useRef(false)
  const queuedUpdates = useRef<AskUpdatePayload[]>([])
  const lastSequence = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastHandledNonce = useRef<number | null>(null)

  // Restore main-process ownership on open. Queue updates during IPC calls
  // and replay only events newer than the snapshot for the active request.
  const applyUpdate = useCallback(({ requestId, event }: AskUpdatePayload) => {
    if (requestId !== activeRequestId.current) return
    if (event.sequence !== undefined) {
      if (event.sequence <= lastSequence.current) return
      lastSequence.current = event.sequence
    }

    if (event.kind === 'text') {
      if (activeTurnSessionId.current !== displayedSessionId.current) return
      setMessages((current) => {
        const last = current[current.length - 1]
        if (last && last.id === STREAMING_ID) {
          return [...current.slice(0, -1), { ...last, content: last.content + event.text }]
        }
        return [...current, { id: STREAMING_ID, role: 'assistant', content: event.text }]
      })
    } else if (event.kind === 'done') {
      const persisted = event.message
      if (activeTurnSessionId.current === displayedSessionId.current) {
        setMessages((current) => [
          ...current.filter((m) => m.id !== STREAMING_ID),
          { id: persisted.id, role: persisted.role, content: persisted.content },
        ])
      }
      setSending(false)
      activeRequestId.current = null
    } else if (event.kind === 'error') {
      setMessages((current) => current.filter((m) => m.id !== STREAMING_ID))
      setError(event.message)
      setSending(false)
      activeRequestId.current = null
    }
    // 'tool_activity' has no dedicated UI yet — ignored.
  }, [])

  const replayUpdates = useCallback(() => {
    awaitingRequest.current = false
    const queued = queuedUpdates.current
    queuedUpdates.current = []
    for (const payload of queued) applyUpdate(payload)
  }, [applyUpdate])

  useEffect(() => window.vellum.onAskUpdate((payload) => {
    if (awaitingRequest.current) queuedUpdates.current.push(payload)
    else applyUpdate(payload)
  }), [applyUpdate])

  // Reload history whenever the open paper changes.
  useEffect(() => {
    let cancelled = false
    contextGeneration.current += 1
    awaitingRequest.current = true
    queuedUpdates.current = []
    lastSequence.current = 0
    setSessionId(null)
    displayedSessionId.current = null
    setInput('')
    setMessages([])
    setError(null)
    setLoadError(null)
    setSending(false)
    setSwitchingSession(false)
    activeRequestId.current = null

    window.vellum
      .askOpen(targetSessionId ? { slug, sessionId: targetSessionId } : slug)
      .then((result) => {
        if (cancelled) return
        setSessionId(result.session.id)
        displayedSessionId.current = result.session.id
        setBackend(result.session.backend === 'codex' ? 'codex' : 'claude')
        const turn = result.activeTurn
        activeRequestId.current = turn?.requestId ?? null
        activeTurnSessionId.current = turn?.chatSessionId ?? null
        lastSequence.current = turn?.sequence ?? 0
        setSending(!!turn)
        const history: DisplayMessage[] = result.messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))
        if (turn?.text && turn.chatSessionId === result.session.id) {
          history.push({ id: STREAMING_ID, role: 'assistant', content: turn.text })
        }
        setMessages(history)
        replayUpdates()
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          awaitingRequest.current = false
          queuedUpdates.current = []
          setLoadError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      cancelled = true
      contextGeneration.current += 1
      activeRequestId.current = null
      queuedUpdates.current = []
      awaitingRequest.current = false
    }
  }, [slug, targetSessionId, replayUpdates])

  const sendTurn = useCallback(async (prompt?: string) => {
    const text = (prompt ?? input).trim()
    if (!text || sessionId === null || sending || awaitingRequest.current || activeRequestId.current) return
    const generation = contextGeneration.current
    awaitingRequest.current = true
    queuedUpdates.current = []
    lastSequence.current = 0

    setError(null)
    if (!prompt) setInput('')
    setSending(true)
    setMessages((current) => [...current, { id: `local-user-${Date.now()}`, role: 'user', content: text }])

    try {
      const { requestId } = await window.vellum.askStart({ chatSessionId: sessionId, slug, text })
      if (generation !== contextGeneration.current) return
      activeRequestId.current = requestId
      activeTurnSessionId.current = sessionId
      replayUpdates()
    } catch (err) {
      if (generation !== contextGeneration.current) return
      awaitingRequest.current = false
      queuedUpdates.current = []
      setError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }, [input, sessionId, sending, slug, replayUpdates])

  // [R1-05] Process injected prompt from PDF text selection actions
  useEffect(() => {
    if (!injectedPrompt || sessionId === null) return
    if (lastHandledNonce.current === injectedPrompt.nonce) return
    lastHandledNonce.current = injectedPrompt.nonce

    if (injectedPrompt.autoSend) {
      void sendTurn(injectedPrompt.text)
    } else {
      setInput((current) => (current ? `${current}\n\n${injectedPrompt.text}` : injectedPrompt.text))
      inputRef.current?.focus()
    }
  }, [injectedPrompt, sessionId, sendTurn])

  const startNewChat = useCallback((nextBackend: ChatBackend = backend) => {
    const generation = ++contextGeneration.current
    setError(null)
    setSending(false)
    setSwitchingSession(true)
    activeRequestId.current = null

    window.vellum
      .askNewChat({ slug, backend: nextBackend })
      .then((result) => {
        if (generation !== contextGeneration.current) return
        setSessionId(result.session.id)
        displayedSessionId.current = result.session.id
        setBackend(result.session.backend === 'codex' ? 'codex' : 'claude')
        setMessages([])
      })
      .catch((err: unknown) => {
        if (generation === contextGeneration.current) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (generation === contextGeneration.current) setSwitchingSession(false)
      })
  }, [backend, slug])

  const selectBackend = useCallback(
    (nextBackend: ChatBackend) => {
      if (nextBackend !== backend) startNewChat(nextBackend)
    },
    [backend, startNewChat],
  )

  const disabled = sessionId === null || sending || switchingSession

  return (
    <div className={styles.askPanel}>
      <div className={styles.header}>
        <ModelSelector backend={backend} disabled={disabled} onChange={selectBackend} />
        <button type="button" className={styles.newChatButton} disabled={disabled} onClick={() => startNewChat()}>
          New chat
        </button>
      </div>

      <div className={styles.thread} aria-live="polite">
        {loadError ? (
          <p className={styles.error} role="alert">
            Could not load chat: {loadError}
          </p>
        ) : messages.length === 0 ? (
          <p className={styles.placeholder}>Ask a question about this paper.</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}
            >
              {message.content}
            </div>
          ))
        )}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <SuggestedQuestions
        slug={slug}
        backend={backend}
        disabled={disabled}
        onSelectQuestion={(prompt) => void sendTurn(prompt)}
      />
      <QuickActions disabled={disabled} onPrompt={(prompt) => void sendTurn(prompt)} />

      <form
        className={styles.inputRow}
        onSubmit={(event) => {
          event.preventDefault()
          void sendTurn()
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className={styles.textInput}
          placeholder="Ask a question about this paper…"
          aria-label="Ask a question"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={disabled}
        />
        <button type="submit" className={styles.sendButton} disabled={disabled || !input.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
