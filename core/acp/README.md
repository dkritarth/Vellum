# core/acp — unified ACP client

Vellum's single AI seam. See `client.ts` for the contract.

## Backends (both official, first-party — no OAuth bridge)

| Backend | Adapter subprocess | Auth source |
|---------|--------------------|-------------|
| `claude` | `claude-code-acp` | Claude plan's Agent-SDK credit |
| `codex`  | `codex-acp`        | ChatGPT plan (Codex sign-in) |

Adding a backend later = spawn a different ACP server. No new client code.

## First task before wiring

1. Add the verified ACP client dep to `package.json` (do not guess the name —
   check npm; likely `@zed-industries/agent-client-protocol` or the current
   canonical ACP TS lib).
2. Implement `StdioAcpClient`.
3. **Smoke test both backends respond over stdio on the local plan** before any
   UI work. This is the highest-risk assumption in the project.

## Hard rules

- Never route requests through bridged subscription OAuth in a third-party
  harness — banned by Anthropic (Feb 2026), actively blocked. Only the official
  adapters above.
- No raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path. Auth comes from the
  already-signed-in CLIs.
