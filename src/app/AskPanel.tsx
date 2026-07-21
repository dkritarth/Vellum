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

interface AskPanelProps {
  /** Slug of the currently open paper — the chat is scoped to it. */
  slug: string
}

export function AskPanel({ slug }: AskPanelProps): JSX.Element {
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [backend, setBackend] = useState<ChatBackend>('claude')
  const [switchingSession, setSwitchingSession] = useState(false)
  const activeRequestId = useRef<string | null>(null)

  // Reload history whenever the open paper changes.
  useEffect(() => {
    let cancelled = false
    setSessionId(null)
    setMessages([])
    setError(null)
    setLoadError(null)
    activeRequestId.current = null

    window.vellum
      .askOpen(slug)
      .then((result) => {
        if (cancelled) return
        setSessionId(result.session.id)
        setBackend(result.session.backend === 'codex' ? 'codex' : 'claude')
        setMessages(result.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  // One subscription for the panel's lifetime; every event is routed by
  // `activeRequestId` so a stale/late event from a superseded turn is dropped.
  useEffect(() => {
    return window.vellum.onAskUpdate(({ requestId, event }) => {
      if (requestId !== activeRequestId.current) return

      if (event.kind === 'text') {
        setMessages((current) => {
          const last = current[current.length - 1]
          if (last && last.id === STREAMING_ID) {
            return [...current.slice(0, -1), { ...last, content: last.content + event.text }]
          }
          return [...current, { id: STREAMING_ID, role: 'assistant', content: event.text }]
        })
      } else if (event.kind === 'done') {
        const persisted = event.message
        setMessages((current) => [
          ...current.filter((m) => m.id !== STREAMING_ID),
          { id: persisted.id, role: persisted.role, content: persisted.content },
        ])
        setSending(false)
        activeRequestId.current = null
      } else if (event.kind === 'error') {
        setMessages((current) => current.filter((m) => m.id !== STREAMING_ID))
        setError(event.message)
        setSending(false)
        activeRequestId.current = null
      }
      // 'tool_activity' has no dedicated UI yet — ignored.
    })
  }, [])

  const sendTurn = useCallback(async (prompt?: string) => {
    const text = (prompt ?? input).trim()
    if (!text || sessionId === null || sending) return

    setError(null)
    if (!prompt) setInput('')
    setSending(true)
    setMessages((current) => [...current, { id: `local-user-${Date.now()}`, role: 'user', content: text }])

    try {
      const { requestId } = await window.vellum.askStart({ chatSessionId: sessionId, slug, text })
      activeRequestId.current = requestId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }, [input, sessionId, sending, slug])

  const startNewChat = useCallback((nextBackend: ChatBackend = backend) => {
    setError(null)
    setSending(false)
    setSwitchingSession(true)
    activeRequestId.current = null

    window.vellum
      .askNewChat({ slug, backend: nextBackend })
      .then((result) => {
        setSessionId(result.session.id)
        setBackend(result.session.backend === 'codex' ? 'codex' : 'claude')
        setMessages([])
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSwitchingSession(false))
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

      <QuickActions disabled={disabled} onPrompt={(prompt) => void sendTurn(prompt)} />

      <form
        className={styles.inputRow}
        onSubmit={(event) => {
          event.preventDefault()
          void sendTurn()
        }}
      >
        <input
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
