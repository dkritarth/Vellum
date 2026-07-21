// ChatManager — orchestrates one Ask-tab turn: sends the user's text through
// core/acp with the open paper's paper.md as a context file (grounding —
// see AGENTS.md, no RAG: the agent reads the file itself), streams updates
// back to the caller, and persists both sides of the turn to SQLite via
// core/chat/repo.ts.
//
// This module is the seam electron/main.ts's streaming IPC handler drives.
// It never touches Electron/IPC itself — testable head-to-toe against a
// fake AcpClient and an in-memory DB (see manager.test.ts).
//
// Session reuse: `claude-code-acp`'s session/new cold start is ~16s (see
// core/acp/stdio-client.ts). Re-spawning per turn would tax every follow-up
// question, so one AcpSession is cached per paper slug and reused across
// turns until "new chat" (or the paper's tab closes — callers may call
// `disposeAll()` on app shutdown). "New chat" always gets a genuinely fresh
// agent conversation: the cached ACP session is disposed, not just the SQL
// row swapped.

import type { Database } from 'better-sqlite3'

import type { AcpBackend, AcpClient, AcpSession, AcpUpdate } from '../acp/client.js'
import type { ChatMessage, ChatSession } from './repo.js'
import { addChatMessage, createChatSession, getChatMessages, getLatestChatSession } from './repo.js'

const DEFAULT_BACKEND: AcpBackend = 'claude'

/** Renderer-facing shape of a streamed turn event — a thin, UI-friendly
 * projection of AcpUpdate (whose `data` is intentionally `unknown`/raw ACP
 * shape). `text` carries plain accumulable string chunks; `done` carries the
 * persisted assistant ChatMessage so the caller never has to re-fetch it. */
export type AskStreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_activity' }
  | { kind: 'done'; message: ChatMessage }
  | { kind: 'error'; message: string }

/** Pulls plain text out of an AcpUpdate whose kind is 'text' (a raw ACP
 * ContentBlock in `data`). Mirrors core/ingest/extract.ts's textFromUpdate —
 * kept local/small rather than shared, per AGENTS.md's "small deep modules"
 * (the two call sites want different failure behavior: extract accumulates
 * silently, this one also needs to stream text as-you-go). */
function textFromUpdate(update: AcpUpdate): string {
  const data = update.data
  if (typeof data !== 'object' || data === null) return ''
  const block = data as Record<string, unknown>
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  return ''
}

function errorMessageFromUpdate(update: AcpUpdate): string {
  const data = update.data
  if (typeof data === 'object' && data !== null) {
    const message = (data as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return 'ACP turn failed'
}

/** Grounding preamble sent to the agent alongside the user's question (never
 * persisted — chat_messages stores the raw user text only). Directs the
 * agent to read the context file itself (no RAG — see AGENTS.md) and to
 * ground its answer in the paper's actual content, satisfying [P1-10]'s
 * "reply cites sections/quotes from the paper" acceptance criterion. */
function buildGroundingPreamble(mdPath: string): string {
  return [
    `You are discussing the paper at ${mdPath}. Read it with your file tools before answering.`,
    'Ground every answer in the paper itself: cite the section it comes from and quote short passages where relevant, rather than answering from general knowledge alone.',
  ].join('\n')
}

/** Recaps prior turns for a session whose ACP agent process was just
 * (re)spawned — e.g. the app restarted, or "new chat" wasn't used but the
 * in-memory AcpSession cache was evicted after an error. Without this, a
 * fresh AcpSession has no memory of a chat's persisted history even though
 * the UI still shows it as one continuous thread. Kept short (role: content
 * pairs) — good enough for the agent to pick up context, not a token-budget
 * concern at MVP chat lengths. */
function buildRecap(priorMessages: ChatMessage[]): string {
  const lines = priorMessages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
  return ['Prior conversation in this chat (for context — this is a resumed session):', ...lines].join('\n')
}

function buildPromptText(mdPath: string, text: string, priorMessages: ChatMessage[]): string {
  const parts = [buildGroundingPreamble(mdPath)]
  if (priorMessages.length > 0) parts.push(buildRecap(priorMessages))
  parts.push(`Question: ${text}`)
  return parts.join('\n\n')
}

export interface OpenChatParams {
  db: Database
  paperSlug: string
  backend?: AcpBackend
}

export interface AskOpenResult {
  session: ChatSession
  messages: ChatMessage[]
}

export interface RunTurnParams {
  db: Database
  chatSessionId: number
  paperSlug: string
  mdPath: string
  text: string
  backend?: AcpBackend
}

/** IPC-boundary params for starting a turn — the single source of truth
 * shared by electron/main.ts (validates + passes through) and
 * electron/preload.ts (types the renderer-facing call). Living here, not
 * duplicated in both, keeps the wire contract from drifting. */
export interface AskStartParams {
  chatSessionId: number
  slug: string
  text: string
}

export class ChatManager {
  private readonly acpSessions = new Map<string, AcpSession>()

  constructor(private readonly client: AcpClient) {}

  /**
   * Open (or reload) the Ask tab for a paper: reuses the most recent chat
   * session + its history if one exists, else starts a brand new one.
   * Never touches the ACP layer — cheap, safe to call on every tab focus.
   */
  openChat(params: OpenChatParams): AskOpenResult {
    const backend = params.backend ?? DEFAULT_BACKEND
    const existing = getLatestChatSession(params.db, params.paperSlug)
    const session = existing ?? createChatSession(params.db, { paperSlug: params.paperSlug, backend })
    const messages = getChatMessages(params.db, session.id)
    return { session, messages }
  }

  /**
   * Start a genuinely fresh conversation: disposes any cached ACP session
   * for this paper (so the agent has no memory of the prior thread) and
   * inserts a new chat_sessions row.
   */
  async newChat(params: OpenChatParams): Promise<ChatSession> {
    const backend = params.backend ?? DEFAULT_BACKEND
    await this.disposeSession(params.paperSlug)
    return createChatSession(params.db, { paperSlug: params.paperSlug, backend })
  }

  /**
   * Run one turn: persists the user message immediately, streams the
   * assistant's reply via `onEvent`, and persists the full assistant
   * message once the turn completes. Never throws — adapter/spawn/stream
   * failures surface as an `error` AskStreamEvent so callers (the IPC
   * handler) can forward them to the UI instead of crashing.
   */
  async runTurn(params: RunTurnParams, onEvent: (event: AskStreamEvent) => void): Promise<void> {
    const backend = params.backend ?? DEFAULT_BACKEND

    // Snapshot history *before* adding this turn's user message — this is
    // what gets recapped into a freshly (re)spawned AcpSession below, so it
    // must not include the message we're about to persist.
    const priorMessages = getChatMessages(params.db, params.chatSessionId)
    addChatMessage(params.db, { sessionId: params.chatSessionId, role: 'user', content: params.text })

    let acpSession: AcpSession
    let freshlySpawned: boolean
    try {
      ;({ session: acpSession, freshlySpawned } = await this.getOrCreateAcpSession(params.paperSlug, backend))
    } catch (err) {
      onEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }

    // Only recap on a freshly spawned session (app restart, or a prior
    // turn's error evicted the cache) — an already-live session already has
    // the conversation in its own context, and re-sending it every turn
    // would just burn tokens for no benefit.
    const promptText = buildPromptText(params.mdPath, params.text, freshlySpawned ? priorMessages : [])

    let accumulated = ''
    try {
      for await (const update of acpSession.prompt({ text: promptText, contextFiles: [params.mdPath] })) {
        if (update.kind === 'text') {
          const chunk = textFromUpdate(update)
          if (chunk) {
            accumulated += chunk
            onEvent({ kind: 'text', text: chunk })
          }
        } else if (update.kind === 'tool_call' || update.kind === 'tool_result') {
          onEvent({ kind: 'tool_activity' })
        } else if (update.kind === 'error') {
          // A broken turn likely means a broken session — evict the cache
          // so the next turn spawns fresh rather than reusing a dead one.
          await this.disposeSession(params.paperSlug)
          onEvent({ kind: 'error', message: errorMessageFromUpdate(update) })
          return
        } else if (update.kind === 'done') {
          break
        }
      }
    } catch (err) {
      await this.disposeSession(params.paperSlug)
      onEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }

    const message = addChatMessage(params.db, {
      sessionId: params.chatSessionId,
      role: 'assistant',
      content: accumulated,
    })
    onEvent({ kind: 'done', message })
  }

  /** Dispose every cached ACP session. Call on app shutdown. */
  async disposeAll(): Promise<void> {
    const slugs = [...this.acpSessions.keys()]
    await Promise.all(slugs.map((slug) => this.disposeSession(slug)))
  }

  private async getOrCreateAcpSession(
    paperSlug: string,
    backend: AcpBackend,
  ): Promise<{ session: AcpSession; freshlySpawned: boolean }> {
    const cached = this.acpSessions.get(paperSlug)
    if (cached) return { session: cached, freshlySpawned: false }
    const session = await this.client.newSession(backend)
    this.acpSessions.set(paperSlug, session)
    return { session, freshlySpawned: true }
  }

  private async disposeSession(paperSlug: string): Promise<void> {
    const session = this.acpSessions.get(paperSlug)
    if (!session) return
    this.acpSessions.delete(paperSlug)
    await session.dispose().catch(() => undefined)
  }
}
