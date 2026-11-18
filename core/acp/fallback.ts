// Background agent work (ingest metadata extraction and summary) has no chat
// in which the user picked a backend. Trying only Claude silently degraded
// every import on Codex-only installs, so these callers try an ordered list.
// A backend counts as working only when its turn produces an accepted
// result, not merely when its session starts. One deadline bounds the whole
// chain, because each session start may take up to the client's handshake
// timeout (a cold Claude start legitimately needs about 16 s).

import type { AcpBackend, AcpClient, AcpSession } from './client.js'

/** Codex is the validated priority backend, then Claude, then Gemini. */
export const DEFAULT_BACKEND_ORDER: readonly AcpBackend[] = ['codex', 'claude', 'antigravity']

/** Total time background work may spend across backends. */
export const BACKGROUND_DEADLINE_MS = 120_000

/** Turns run at most this many times per call (first try plus one retry). */
export const BACKGROUND_MAX_TURNS = 2

/** `preferred` first, then the remaining defaults, without duplicates. */
export function backendOrder(preferred?: AcpBackend | readonly AcpBackend[]): AcpBackend[] {
  const head = preferred === undefined ? [] : typeof preferred === 'string' ? [preferred] : [...preferred]
  return [...new Set([...head, ...DEFAULT_BACKEND_ORDER])]
}

/** Start a session within `ms`, or undefined. A session that starts after
 * the budget ran out is disposed instead of leaking its adapter. */
async function startWithin(client: AcpClient, backend: AcpBackend, ms: number): Promise<AcpSession | undefined> {
  const attempt = client.newSession(backend)
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'expired'>((resolve) => { timer = setTimeout(() => resolve('expired'), ms) })
  const outcome = await Promise.race([attempt.catch(() => undefined), expired])
  clearTimeout(timer)
  if (outcome === 'expired') {
    attempt.then((late) => late.dispose().catch(() => undefined), () => undefined)
    return undefined
  }
  return outcome
}

/** Start a session on the first backend that starts, or undefined. */
export async function newSessionWithFallback(
  client: AcpClient,
  backends: readonly AcpBackend[],
  deadlineMs = BACKGROUND_DEADLINE_MS,
): Promise<{ session: AcpSession; backend: AcpBackend } | undefined> {
  const deadline = Date.now() + deadlineMs
  for (const backend of backends) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return undefined
    const session = await startWithin(client, backend, remaining)
    if (session) return { session, backend }
  }
  return undefined
}

export interface FallbackRun<T> {
  result: T
  backend: AcpBackend
  accepted: boolean
}

/**
 * Run `turn` on each backend in order until one returns a result `accept`
 * approves. Backends whose session does not start are skipped. At most
 * `maxTurns` turns run, and nothing starts after `deadlineMs`. Returns the
 * last turn's result when none was accepted, or undefined when no session
 * started. Sessions are always disposed.
 */
export async function runWithFallback<T>(
  client: AcpClient,
  backends: readonly AcpBackend[],
  turn: (session: AcpSession) => Promise<T>,
  accept: (result: T) => boolean,
  options: { deadlineMs?: number; maxTurns?: number } = {},
): Promise<FallbackRun<T> | undefined> {
  const deadline = Date.now() + (options.deadlineMs ?? BACKGROUND_DEADLINE_MS)
  const maxTurns = options.maxTurns ?? BACKGROUND_MAX_TURNS
  let last: FallbackRun<T> | undefined
  let turns = 0
  for (const backend of backends) {
    if (turns >= maxTurns) break
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const session = await startWithin(client, backend, remaining)
    if (!session) continue
    turns += 1
    try {
      const result = await turn(session)
      last = { result, backend, accepted: accept(result) }
      if (last.accepted) return last
    } finally {
      await session.dispose().catch(() => undefined)
    }
  }
  return last
}
