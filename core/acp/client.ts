// Unified ACP (Agent Client Protocol) client — Vellum's single AI seam.
//
// Vellum is an ACP *client*. Each AI backend is an ACP *server* subprocess
// spawned over stdio and driven with the same JSON-RPC surface:
//
//   Claude -> `claude-code-acp`  (draws from the sanctioned Agent-SDK plan credit)
//   Codex  -> `codex-acp`        (draws from the ChatGPT plan via Codex sign-in)
//   (later) Gemini / any ACP-compatible agent — no new integration code.
//
// HARD RULES (see AGENTS.md):
//   - Never bridge subscription OAuth into a third-party harness. Banned by
//     Anthropic (Feb 2026) and actively blocked. Only official first-party
//     adapters (claude-code-acp / codex-acp) are allowed.
//   - No raw ANTHROPIC_API_KEY / OPENAI_API_KEY path. Auth comes from the
//     already-signed-in CLIs.
//
// This file defines the contract only. The first ACP task card wires the real
// transport (add the verified ACP dep to package.json first).

export type AcpBackend = 'claude' | 'codex'

export interface AcpPromptRequest {
  /** Free-text user turn. */
  text: string
  /** Absolute paths the agent may read (e.g. papers/<slug>/paper.md). */
  contextFiles?: string[]
}

export interface AcpUpdate {
  kind: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error'
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

// TODO(acp-task-1): implement StdioAcpClient — spawn the adapter subprocess,
// speak ACP JSON-RPC over stdio, map events onto AcpUpdate. Prove both
// backends respond before any UI wiring (the on-plan smoke test).
