// Chat persistence against `chat_sessions` / `chat_messages`
// (core/store/schema.ts SCHEMA_V1 — both tables already exist, no migration
// needed for [P1-10]). Mirrors core/library/repo.ts's shape: parameterized
// SQL only, JSON columns normalized at this boundary so callers never touch
// raw SQLite rows.
//
// Storage split reminder (AGENTS.md): chat text is STATE (conversation
// history), not paper content — SQLite is the right place for it. The
// paper's own markdown/PDF never passes through this module.

import type { Database } from 'better-sqlite3'

export type ChatRole = 'user' | 'assistant'

export interface ChatSession {
  id: number
  paperSlug: string
  backend: string
  title: string | null
  createdAt: string
}

export interface ChatMessage {
  id: number
  sessionId: number
  role: ChatRole
  content: string
  createdAt: string
}

interface ChatSessionRow {
  id: number
  paper_slug: string
  backend: string
  title: string | null
  created_at: string
}

interface ChatMessageRow {
  id: number
  session_id: number
  role: string
  content: string
  created_at: string
}

function toSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    paperSlug: row.paper_slug,
    backend: row.backend,
    title: row.title,
    createdAt: row.created_at,
  }
}

function toMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    // `role` is only ever written as 'user'/'assistant' by addChatMessage
    // below (trusted, our own schema) — coercing an unexpected value to
    // 'user' rather than throwing is a defensive fallback for a corrupt row,
    // not an expected path.
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.created_at,
  }
}

/** Create a new chat session for a paper. Always inserts a fresh row — the
 * "new chat" action's persistence half; caller decides when that's wanted. */
export function createChatSession(
  db: Database,
  params: { paperSlug: string; backend: string; title?: string | null },
): ChatSession {
  const createdAt = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO chat_sessions (paper_slug, backend, title, created_at)
       VALUES (@paperSlug, @backend, @title, @createdAt)`,
    )
    .run({
      paperSlug: params.paperSlug,
      backend: params.backend,
      title: params.title ?? null,
      createdAt,
    })
  return {
    id: Number(result.lastInsertRowid),
    paperSlug: params.paperSlug,
    backend: params.backend,
    title: params.title ?? null,
    createdAt,
  }
}

/** Most recently created chat session for a paper, or undefined if none
 * exist yet — used to reload history when a paper's Ask tab (re)opens. */
export function getLatestChatSession(db: Database, paperSlug: string): ChatSession | undefined {
  const row = db
    .prepare(`SELECT * FROM chat_sessions WHERE paper_slug = ? ORDER BY id DESC LIMIT 1`)
    .get(paperSlug) as ChatSessionRow | undefined
  return row ? toSession(row) : undefined
}

/** Fetch one chat session by id, or undefined if it doesn't exist. Used by
 * the IPC layer to verify a caller-supplied `chatSessionId` actually belongs
 * to the paper slug it claims — a renderer bug (or a hostile page) could
 * otherwise write turns onto another paper's chat by passing a mismatched
 * pair, since `chatSessionId` and `slug` arrive as two independent,
 * unrelated IPC params. */
export function getChatSession(db: Database, id: number): ChatSession | undefined {
  const row = db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as ChatSessionRow | undefined
  return row ? toSession(row) : undefined
}

/** All messages for a session, oldest first (reading order). */
export function getChatMessages(db: Database, sessionId: number): ChatMessage[] {
  const rows = db
    .prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as ChatMessageRow[]
  return rows.map(toMessage)
}

/** Append one message to a session. */
export function addChatMessage(
  db: Database,
  params: { sessionId: number; role: ChatRole; content: string },
): ChatMessage {
  const createdAt = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, role, content, created_at)
       VALUES (@sessionId, @role, @content, @createdAt)`,
    )
    .run({ sessionId: params.sessionId, role: params.role, content: params.content, createdAt })
  return {
    id: Number(result.lastInsertRowid),
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    createdAt,
  }
}

export interface ChatSessionSummary {
  id: number
  paperSlug: string
  paperTitle: string | null
  backend: string
  title: string
  preview: string | null
  messageCount: number
  createdAt: string
  lastActiveAt: string
}

export interface ListChatSessionsOptions {
  search?: string
  limit?: number
}

/**
 * List all chat sessions across papers, ordered by most recent activity.
 * Stable title fallback is derived from first user message if title is not set.
 * Returns paper title from `papers` table (or null if paper was deleted).
 */
export function listChatSessions(
  db: Database,
  options: ListChatSessionsOptions = {},
): ChatSessionSummary[] {
  const { search, limit = 100 } = options

  let sql = `
    SELECT 
      cs.id,
      cs.paper_slug AS paperSlug,
      p.title AS paperTitle,
      cs.backend,
      cs.title,
      cs.created_at AS createdAt,
      COUNT(cm.id) AS messageCount,
      MAX(cm.created_at) AS lastMessageAt,
      (
        SELECT content FROM chat_messages 
        WHERE session_id = cs.id AND role = 'user' 
        ORDER BY id ASC LIMIT 1
      ) AS firstUserMessage,
      (
        SELECT content FROM chat_messages 
        WHERE session_id = cs.id 
        ORDER BY id DESC LIMIT 1
      ) AS lastMessage
    FROM chat_sessions cs
    LEFT JOIN papers p ON cs.paper_slug = p.slug
    LEFT JOIN chat_messages cm ON cs.id = cm.session_id
  `

  const conditions: string[] = []
  const params: unknown[] = []

  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim().toLowerCase()}%`
    conditions.push(`(
      LOWER(COALESCE(cs.title, '')) LIKE ? OR
      LOWER(COALESCE(p.title, '')) LIKE ? OR
      LOWER(cs.paper_slug) LIKE ? OR
      cs.id IN (SELECT session_id FROM chat_messages WHERE LOWER(content) LIKE ?)
    )`)
    params.push(pattern, pattern, pattern, pattern)
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }

  sql += `
    GROUP BY cs.id
    ORDER BY COALESCE(MAX(cm.created_at), cs.created_at) DESC
    LIMIT ?
  `
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number
    paperSlug: string
    paperTitle: string | null
    backend: string
    title: string | null
    createdAt: string
    messageCount: number
    lastMessageAt: string | null
    firstUserMessage: string | null
    lastMessage: string | null
  }>

  return rows.map((row) => {
    let displayTitle = row.title
    if (!displayTitle || displayTitle.trim().length === 0) {
      if (row.firstUserMessage && row.firstUserMessage.trim().length > 0) {
        const cleaned = row.firstUserMessage.trim().replace(/\s+/g, ' ')
        displayTitle = cleaned.length > 60 ? cleaned.slice(0, 57) + '...' : cleaned
      } else {
        displayTitle = `Chat #${row.id}`
      }
    }

    let preview = row.lastMessage
    if (preview && preview.length > 100) {
      preview = preview.slice(0, 97) + '...'
    }

    return {
      id: row.id,
      paperSlug: row.paperSlug,
      paperTitle: row.paperTitle,
      backend: row.backend,
      title: displayTitle,
      preview: preview ?? null,
      messageCount: Number(row.messageCount),
      createdAt: row.createdAt,
      lastActiveAt: row.lastMessageAt || row.createdAt,
    }
  })
}

/** Update the title of a chat session. */
export function updateChatSessionTitle(db: Database, id: number, title: string): void {
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title.trim(), id)
}

/** Delete a chat session and cascade delete its messages. */
export function deleteChatSession(db: Database, id: number): void {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
}
