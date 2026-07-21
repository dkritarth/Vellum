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
