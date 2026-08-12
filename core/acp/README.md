# core/acp — unified ACP client

Vellum's single AI seam. See `client.ts` for the contract, `stdio-client.ts`
for the implementation ([P1-01] — done).

## Backends (both official, first-party — no OAuth bridge)

| Backend | Adapter subprocess | Auth source |
|---------|--------------------|-------------|
| `claude` | `claude-code-acp` | Claude plan's Agent-SDK credit |
| `codex`  | `codex-acp`        | ChatGPT plan (Codex sign-in) |

Adding a backend later = spawn a different ACP server. No new client code.

Install the maintained Codex adapter as
`@agentclientprotocol/codex-acp`. The older
`@zed-industries/codex-acp` package is deprecated and embeds an older Codex
runtime even when a newer standalone `codex` CLI is on `PATH`. Record the
adapter package and version during live verification; executable name alone
does not distinguish them.

## Dependency

`@agentclientprotocol/sdk` (npm, verified on the registry 2026-07-21). This is
the **current canonical** ACP TypeScript library — `@zed-industries/agent-client-protocol`
(the name suggested in the wiki card as a guess) is deprecated upstream and
renamed to this package. Pinned to `1.2.1`.

## `StdioAcpClient`

Spawns the backend's adapter subprocess (`stdio: ['pipe', 'pipe', 'inherit']`
— stderr passes straight through for adapter diagnostics), wraps its
stdin/stdout in an ACP `ndJsonStream`, and drives `ClientSideConnection`
through `initialize` → `session/new` → `session/prompt`. `session/update`
notifications are routed by session id into a small per-prompt async queue
that `AcpSession.prompt()` yields from, mapped onto `AcpUpdate` via
`mapSessionUpdate`. The RPC promise from `session/prompt` settling pushes the
terminal `done`/`error` update and closes the queue.

The `requestPermission` client handler auto-allows (falls back to cancel if
no allow option is offered) — there's no UI yet to ask a human, so headless
tool-call permission is a deliberate placeholder until the Ask panel wires a
real prompt.

`SpawnAdapter` is an injectable seam: unit tests substitute a small
dependency-free ndjson JSON-RPC script in place of the real adapter binary,
so `npm test` never requires `claude-code-acp` / `codex-acp` to be installed.

### Nested-session handling

`claude-code-acp` refuses to launch when the parent process has `CLAUDECODE`
set — its own guard against being launched inside another Claude Code
session. That var (and `CLAUDE_CODE_SSE_PORT`) leaks into anything spawned
from a Claude Code terminal or agent (a developer shell, our own agents, the
smoke test), even though Vellum's Electron process itself never sets it.
`defaultSpawnAdapter` strips both from the adapter's child env via
`buildAdapterEnv` (exported, unit-tested standalone) before spawning, so the
client works whether or not it's running nested — no manual `env -u
CLAUDECODE` needed for the normal case. Everything else the adapter needs
for auth (`PATH`, `HOME`, the CLI's own creds/config env) still passes
through untouched.

### Per-operation timeouts

`StdioAcpClient` takes an optional second constructor arg,
`StdioAcpClientTimeouts` (`{ handshakeMs?, turnMs? }`, defaulting to 60s /
60s). `newSession()` races the `initialize` + `session/new` handshake against
`handshakeMs`; `prompt()` races each turn against `turnMs`. On timeout the
child adapter process is killed and the caller gets a thrown error
(`newSession`) or a terminal `{ kind: 'error' }` update (`prompt`) instead of
hanging forever — this is what protects against a stalled adapter (e.g. an
errored codex-acp turn, or any other hang mid-session).

On POSIX, adapters start in their own process group. Session disposal and
handshake/turn failures terminate the complete adapter process tree, wait up
to one second, then escalate to `SIGKILL` if required. This matters for npm
launcher scripts that spawn a native adapter child: killing only the launcher
can otherwise orphan the native process. Windows terminates the direct child,
waits with the same bound, and escalates before reporting cleanup failure.

The handshake default is deliberately generous, not tight: measured against
a real cold-start `claude-code-acp` (`CLAUDECODE` stripped), `initialize`
returns in ~226ms but `session/new` alone legitimately takes ~16.2s — it
loads a large skill/command set (a huge `available_commands_update` dump,
dozens of skills). A too-tight budget here would regress a path that worked
fine (if slowly) before this timeout existed.

## Live on-plan smoke test

```bash
npm run smoke:acp             # both backends
npm run smoke:acp -- claude   # just claude-code-acp
npm run smoke:acp -- codex    # just codex-acp
```

Requires the adapter CLI(s) actually installed and signed in to your
Claude Pro/Max or ChatGPT plan. This is **not** part of `npm test` / CI — it's
a separate, honest check of the real sanctioned-plan path. See `smoke.ts`.

Smoke output is sanitized and compact: UTC start/end times, streamed text,
update kinds, and terminal stop reason. Adapter diagnostics remain on stderr.

If a service rollout selects a model newer than the installed adapter runtime,
set `VELLUM_CODEX_MODEL` to a model supported by that runtime while upgrading
the adapter. The value goes directly to the first-party adapter as
`-c model=<value>` without a shell or alternate authentication path:

```bash
VELLUM_CODEX_MODEL=gpt-5.5 npm run smoke:acp -- codex
```

Runs fine from inside a Claude Code terminal/agent now (the `CLAUDECODE`
stripping above handles it automatically) and no longer hangs forever on a
stalled adapter (the turn/handshake timeouts above make it fail loud
instead) — no external alarm needed. If you ever do need the old manual
workaround (e.g. debugging something upstream of `StdioAcpClient` that
re-adds `CLAUDECODE` to the env), `env -u CLAUDECODE npm run smoke:acp`
still works.

## Hard rules

- Never route requests through bridged subscription OAuth in a third-party
  harness — banned by Anthropic (Feb 2026), actively blocked. Only the official
  adapters above.
- No raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path. Auth comes from the
  already-signed-in CLIs.
