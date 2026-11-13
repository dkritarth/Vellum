// Unified ACP (Agent Client Protocol) client — Vellum's single AI seam.
//
// Vellum is an ACP *client*. Each AI backend is an ACP *server* subprocess
// spawned over stdio and driven with the same JSON-RPC surface:
//
//   Claude -> `claude-code-acp`  (draws from the sanctioned Agent-SDK plan credit)
//   Codex  -> `codex-acp`        (draws from the ChatGPT plan via Codex sign-in)
//   Antigravity -> `agy acp`      (Google's first-party Antigravity CLI; Gemini
//                                  models on the user's Google AI plan. The
//                                  standalone Gemini CLI no longer accepts
//                                  personal Google sign-in, so it is not a backend.)
//
// HARD RULES (see AGENTS.md):
//   - Never bridge subscription OAuth into a third-party harness. Banned by
//     Anthropic (Feb 2026) and actively blocked. Only official first-party
//     adapters (claude-code-acp / codex-acp / agy acp) are allowed.
//   - No raw ANTHROPIC_API_KEY / OPENAI_API_KEY path. Auth comes from the
//     already-signed-in CLIs.
//
// This file defines the contract only. See stdio-client.ts for the real
// transport ([P1-01] — StdioAcpClient, over @agentclientprotocol/sdk).

export type AcpBackend = 'claude' | 'codex' | 'antigravity'

/** Every supported backend, in UI order. */
export const ACP_BACKENDS: readonly AcpBackend[] = ['claude', 'codex', 'antigravity']

/** Human-facing names for the model picker, chat list and usage view. */
export const ACP_BACKEND_LABELS: Record<AcpBackend, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Gemini (Antigravity)',
}

export function isAcpBackend(value: unknown): value is AcpBackend {
  return typeof value === 'string' && (ACP_BACKENDS as readonly string[]).includes(value)
}

export interface AcpPromptRequest {
  /** Free-text user turn. */
  text: string
  /** Absolute paths the agent may read (e.g. papers/<slug>/paper.md). */
  contextFiles?: string[]
}

export interface AcpUpdate {
  kind: 'text' | 'tool_call' | 'tool_result' | 'usage_update' | 'done' | 'error'
  data: unknown
}

export interface AcpSession {
  /** Send a turn; yields streaming updates until `done`. */
  prompt(req: AcpPromptRequest): AsyncIterable<AcpUpdate>
  dispose(): Promise<void>
}

export interface AcpClient {
  /** Spawn the backend's ACP server subprocess and open a session. */
  newSession(backend: AcpBackend): Promise<AcpSession>
}

