// Background agent work (ingest metadata extraction and summary) has no chat
// in which the user picked a backend. Trying only Claude silently degraded
// every import on Codex-only installs, so these callers try an ordered list
// and use the first backend whose session starts.

import type { AcpBackend, AcpClient, AcpSession } from './client.js'

/** Codex is the validated priority backend, then Claude, then Gemini. */
export const DEFAULT_BACKEND_ORDER: readonly AcpBackend[] = ['codex', 'claude', 'antigravity']

/** `preferred` first, then the remaining defaults, without duplicates. */
export function backendOrder(preferred?: AcpBackend | readonly AcpBackend[]): AcpBackend[] {
  const head = preferred === undefined ? [] : typeof preferred === 'string' ? [preferred] : [...preferred]
  return [...new Set([...head, ...DEFAULT_BACKEND_ORDER])]
}

/** Start a session on the first backend that works, or undefined when none
 * does. Session-start failures (adapter missing, not signed in) are not
 * errors for background work; the caller degrades. */
export async function newSessionWithFallback(
  client: AcpClient,
  backends: readonly AcpBackend[],
): Promise<{ session: AcpSession; backend: AcpBackend } | undefined> {
  for (const backend of backends) {
    const session = await client.newSession(backend).catch(() => undefined)
    if (session) return { session, backend }
  }
  return undefined
}
