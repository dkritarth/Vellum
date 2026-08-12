# Codex ACP current contract

Research snapshot: 2026-08-12. Scope: Issue #25 contract research only. This
note records executable, authentication, wire-protocol, and lifecycle facts; it
does not claim a successful live Vellum smoke test.

## Executive finding

The machine has a usable-looking but legacy adapter installation:
`@zed-industries/codex-acp` 0.16.0. That repository was archived on 2026-07-22;
the maintained successor is `@agentclientprotocol/codex-acp`, currently
published as 1.1.14. Both expose a `codex-acp` executable, so executable name
alone does not identify implementation or compatibility. Vellum's proof must
record adapter package/version and the `initialize` response, not only PATH.

Installed legacy adapter 0.16.0 embeds Codex Rust crates pinned to Codex
`rust-v0.137.0`; it does not delegate turns to the separately installed
`codex-cli 0.147.0` executable. Therefore `codex --version` is useful auth and
environment evidence, but does not report the engine version inside this
adapter. [Legacy adapter manifest](https://github.com/zed-industries/codex-acp/blob/v0.16.0/Cargo.toml)

## Observed local prerequisites

Read-only commands and package metadata produced this snapshot:

| Check | Observed result | Supported diagnostic |
| --- | --- | --- |
| `command -v codex` | `/opt/homebrew/bin/codex` | `codex --version` / `codex -V` |
| Codex version | `codex-cli 0.147.0` | CLI help explicitly defines `-V, --version` |
| `command -v codex-acp` | `/opt/homebrew/bin/codex-acp` | package-dependent |
| Adapter package | `@zed-industries/codex-acp` 0.16.0 | Read installed `package.json` or `initialize.agentInfo` |
| `codex-acp --version` | rejected as an unexpected argument | This legacy binary supports only `-c/--config` and `-h/--help` |
| Vellum ACP SDK | `@agentclientprotocol/sdk` 1.2.1 | `package.json` / lockfile |

Installed evidence paths:

- `/opt/homebrew/Caskroom/codex/0.147.0/bin/codex`
- `/opt/homebrew/lib/node_modules/@zed-industries/codex-acp/package.json`
- `/opt/homebrew/lib/node_modules/@zed-industries/codex-acp/node_modules/@zed-industries/codex-acp-darwin-arm64/package.json`
- `node_modules/@agentclientprotocol/sdk/package.json`
- `node_modules/@agentclientprotocol/sdk/schema/schema.json`

Current maintained adapter installation differs: its official README supports
`codex-acp --version`, bundles a compatible `@openai/codex`, and allows
`CODEX_PATH` only as an override. Its npm package is
`@agentclientprotocol/codex-acp`, not the installed legacy Zed package.
[Maintained adapter README](https://github.com/agentclientprotocol/codex-acp#installation)

## Authentication contract

Codex supports ChatGPT-managed OAuth, persists and refreshes those credentials,
and exposes `codex login`, `codex login status`, and
`codex login --device-auth`. Issue #25 must use that existing ChatGPT sign-in;
no API-key login is needed or allowed by Vellum's guardrails.
[OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth)
[OpenAI CLI login implementation](https://github.com/openai/codex/blob/main/codex-rs/cli/src/login.rs)

Legacy adapter 0.16.0 uses Codex's shared auth manager and Codex home. It
advertises ChatGPT authentication unless `NO_BROWSER` is set, reloads stored
auth before rejecting a session or prompt as authentication-required, and can
start Codex's browser login flow through ACP. Existing CLI authentication is
therefore expected to be visible to the adapter, but only a live session proves
that for this installation. Remote/headless behavior differs: `NO_BROWSER`
suppresses the adapter's ChatGPT method, while official Codex CLI provides
device authentication.
[Legacy adapter source](https://github.com/zed-industries/codex-acp/blob/v0.16.0/src/codex_agent.rs)
[Legacy adapter README](https://github.com/zed-industries/codex-acp/blob/v0.16.0/README.md)

The maintained adapter also advertises ChatGPT, API-key, and optional custom
gateway auth. Vellum should select or inherit ChatGPT auth and must not infer
that every advertised method is permitted by project policy.
[Maintained adapter authentication](https://github.com/agentclientprotocol/codex-acp#authentication)

## ACP V1 request and stream semantics

ACP wire messages use newline-delimited JSON-RPC over stdio. Client initializes
before any session request. `initialize` carries an integer protocol major and
client capabilities; agent returns its negotiated version, capabilities,
optional authentication methods, and optional `agentInfo`. Missing capability
means unsupported. Client should disconnect when returned version is not one it
supports. [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization)
[ACP transports](https://agentclientprotocol.com/protocol/v1/transports)

Installed adapter 0.16.0 responds with ACP V1 and identifies itself as
`codex-acp` with package version. Its declared dependency is ACP crate 0.14.0,
while Vellum uses TypeScript SDK 1.2.1; those artifact versions are not wire
protocol versions. Current stable wire protocol is V1.
[ACP versioning](https://github.com/agentclientprotocol/agent-client-protocol#versioning)
[Legacy adapter manifest](https://github.com/zed-industries/codex-acp/blob/v0.16.0/Cargo.toml)

`session/new` requires an absolute `cwd` and `mcpServers`, then returns a
`sessionId`. Installed 0.16.0 builds a Codex thread, forwards supported client
MCP configuration, and returns that thread/session identity. The same ID must
be used for subsequent prompt, update, cancel, and close operations.
[ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
[Legacy adapter source](https://github.com/zed-industries/codex-acp/blob/v0.16.0/src/codex_agent.rs)

`session/prompt` represents one complete turn. During it, the agent sends zero
or more `session/update` notifications. Relevant Vellum update variants include
`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, and
`tool_call_update`; newer SDK schemas also include plan, command, mode, config,
session-info, and usage updates. Completion is the `session/prompt` response,
whose required `stopReason` may be `end_turn`, `max_tokens`, `max_turn_requests`,
`refusal`, or `cancelled`. Silence, first text, or a tool result is not turn
completion. [ACP prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
[Installed SDK schema](../../node_modules/@agentclientprotocol/sdk/schema/schema.json)

This matches Vellum's basic flow: `initialize` -> `session/new` ->
`session/prompt`; route updates by `sessionId`; emit Vellum `done` only after
the prompt RPC resolves. A valid live proof should record sanitized update
kinds, useful response text, and final `stopReason: end_turn` for two turns or
sessions.

## Cancellation and termination

`session/cancel` is a notification for an active turn. Agent should stop model
and tool work, flush pending updates, then resolve the original prompt with
`stopReason: cancelled`. Cancellation does not itself close session or adapter
process. [ACP cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)

`session/close`, when supported/advertised, cancels in-flight work and releases
that session's resources. Legacy adapter 0.16.0 implements close and explicitly
drains shutdown/abort events so prompt callers receive clean cancellation.
Process shutdown remains separate from turn cancellation and session close.
[ACP session-close RFD](https://agentclientprotocol.com/rfds/session-close)
[Legacy adapter thread shutdown](https://github.com/zed-industries/codex-acp/blob/v0.16.0/src/thread.rs)

Vellum currently kills the child on `dispose()` and timeout rather than sending
`session/cancel` or negotiated `session/close`. Killing provides a final safety
boundary, but live verification must explicitly check for no orphan process.
A future lifecycle fix should prefer cancel/close and retain bounded forced
termination as fallback; any such behavior change needs regression tests for
stalled prompt and non-exiting child paths.

## Compatibility constraints for Issue #25

1. Identify which package owns `codex-acp` on PATH. Installed legacy 0.16.0 and
   maintained 1.1.x have materially different internals and version flags.
2. Capture `initialize.protocolVersion`, `agentInfo`, and advertised
   capabilities. Do not infer compatibility from npm/SDK artifact versions.
3. Treat installed CLI 0.147.0 and legacy adapter's embedded Codex 0.137.0 as
   separate runtimes. CLI sign-in state may be shared; executable version is
   not.
4. Use ACP V1 semantics. Do not depend on draft/newer protocol features unless
   negotiated.
5. Keep consuming updates until prompt response resolves. Preserve unknown
   update variants rather than treating them as fatal or completion.
6. Bound initialize/session creation and each prompt. On timeout, cancel/close
   when possible, terminate process as fallback, and verify no orphan remains.
7. Existing ChatGPT authentication is the sanctioned path. Do not set or
   solicit `OPENAI_API_KEY`, `CODEX_API_KEY`, or custom-gateway credentials.

## Limits of this research

- No credential files or tokens were read, changed, or copied.
- No browser sign-in or authentication mutation was performed.
- No prompt was sent and no live ACP session was created by this research task.
- Package documentation and source establish intended contracts, not successful
  use of Kritarth's current subscription. `npm run smoke:acp -- codex`, a
  second prompt/session, timestamps, sanitized updates, and orphan-process
  inspection remain required live evidence.
- The installed legacy repository is archived. Current maintained adapter
  behavior may continue changing; pin and report exact package versions in any
  reproducible result.
