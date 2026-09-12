import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatSessionSummary } from '../../core/chat/repo'
import styles from './ChatsList.module.css'

interface ChatsListProps {
  selectedSessionId: number | null
  onSelectSession: (session: ChatSessionSummary) => void
}

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export function ChatsList({ selectedSessionId, onSelectSession }: ChatsListProps): JSX.Element {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const listRef = useRef<HTMLUListElement>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const data = await window.vellum.chatListSessions({ search })
      setSessions(data)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void fetchSessions()
    const interval = setInterval(fetchSessions, 2000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const handleDelete = async (e: React.MouseEvent, session: ChatSessionSummary) => {
    e.stopPropagation()
    const confirmed = window.confirm(`Delete conversation "${session.title}"?`)
    if (!confirmed) return
    try {
      await window.vellum.chatDeleteSession(session.id)
      await fetchSessions()
    } catch (err) {
      console.error('Failed to delete chat session:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (sessions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        const next = prev < sessions.length - 1 ? prev + 1 : 0
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : sessions.length - 1
        return next
      })
    } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < sessions.length) {
      e.preventDefault()
      onSelectSession(sessions[focusedIndex])
    }
  }

  return (
    <div className={styles.container} onKeyDown={handleKeyDown}>
      <div className={styles.searchHeader}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search chats…"
          aria-label="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <div className={styles.errorState} role="alert">
          Failed to load chats: {error}
        </div>
      ) : loading && sessions.length === 0 ? (
        <div className={styles.emptyState}>Loading chats…</div>
      ) : sessions.length === 0 ? (
        <div className={styles.emptyState}>
          {search ? `No chats matching "${search}"` : 'No conversations yet.'}
        </div>
      ) : (
        <ul className={styles.list} ref={listRef} role="listbox" aria-label="Chat sessions">
          {sessions.map((session, index) => {
            const isSelected = selectedSessionId === session.id
            const isFocused = focusedIndex === index
            const backendClass =
              session.backend === 'claude'
                ? styles.badgeClaude
                : session.backend === 'codex'
                  ? styles.badgeCodex
                  : styles.badgeGeneric

            return (
              <li
                key={session.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                className={`${styles.item} ${isSelected ? styles.itemActive : ''} ${
                  isFocused ? styles.itemActive : ''
                }`}
                onClick={() => onSelectSession(session)}
                onFocus={() => setFocusedIndex(index)}
              >
                <div className={styles.itemTitleRow}>
                  <span className={styles.itemTitle} title={session.title}>
                    {session.title}
                  </span>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label={`Delete chat ${session.title}`}
                    title="Delete chat"
                    onClick={(e) => handleDelete(e, session)}
                  >
                    ✕
                  </button>
                </div>

                <div
                  className={`${styles.itemPaper} ${!session.paperTitle ? styles.missingPaper : ''}`}
                  title={session.paperTitle || `Paper slug: ${session.paperSlug} (not in library)`}
                >
                  📄 {session.paperTitle || '(Paper not in library)'}
                </div>

                <div className={styles.itemMeta}>
                  <span className={`${styles.badge} ${backendClass}`}>{session.backend}</span>
                  <span className={styles.msgCount}>
                    {session.messageCount} {session.messageCount === 1 ? 'turn' : 'turns'}
                  </span>
                  <span className={styles.timestamp} title={session.lastActiveAt}>
                    {formatRelativeTime(session.lastActiveAt)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
