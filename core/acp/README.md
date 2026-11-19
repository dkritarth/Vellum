# core/acp — unified ACP client

Vellum's single AI seam. See `client.ts` for the contract, `stdio-client.ts`
for the implementation ([P1-01] — done).

## Backends (all official, first-party — no OAuth bridge)

| Backend | Adapter subprocess | Auth source |
|---------|--------------------|-------------|
| `claude` | `claude-code-acp` | Claude plan's Agent-SDK credit |
| `codex`  | `codex-acp`        | ChatGPT plan (Codex sign-in) |
| `antigravity` | `agy acp` (Google Antigravity CLI) | Google AI plan (agy's own Google sign-in) |

Adding a backend later = spawn a different ACP server. No new client code.

**Antigravity (Gemini).** Vellum runs `agy acp --app-data-dir antigravity-acp`.
`agy` is resolved from `VELLUM_AGY_PATH`, then `PATH`, then `~/.local/bin/agy`.
Sign in once with `agy acp --login`; agy stores the token itself and Vellum
never reads it. `GEMINI_API_KEY`, `GOOGLE_API_KEY` and Google cloud credentials
are stripped from agy's env. Optional `VELLUM_ANTIGRAVITY_MODEL` (for example
`claude-sonnet-4-6`) is applied with `session/set_config_option`. The
standalone Gemini CLI is not a backend: personal Google sign-in there now
fails with `IneligibleTierError` and points to Antigravity.

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

### Session mode (the policy only works if the adapter asks)

Both adapters start in a mode that approves workspace writes **in-process,
without ever sending `session/request_permission`**, which would bypass the
policy below entirely. Verified against the installed sources
(`claude-agent-acp` 0.107.0, `codex-acp` 2.2.2):

| Backend | Default mode | What it auto-approves | Mode Vellum forces |
| --- | --- | --- | --- |
| `claude` | `auto` (or the user's `permissions.defaultMode`, e.g. `acceptEdits`): `session-mode.js` `resolveInitialPermissionMode` | file edits inside cwd | `default` ("Manual: always ask before making changes") |
| `codex` | `agent` (`auto_review` + `workspace-write`): `AgentMode.DEFAULT_AGENT_MODE` | writes inside the workspace | `read-only` (read-only sandbox, approval `on-request`) |

After `session/new`, `newSession` reads the announced `modes`, sends
`session/set_mode` when the current mode is not the safe one, and logs
`[vellum:acp] session mode backend=… initial=… enforced=…`. It **fails closed**:
if the adapter announces no modes, does not offer the safe mode, rejects
`set_mode`, or announces a `current_mode_update` away from it during the handshake, the
adapter is killed and `newSession` rejects. A `current_mode_update` away from it
after the session exists fails the in-flight turn with an error, kills the
adapter and fails every later prompt. For Codex the child env also carries
`INITIAL_AGENT_MODE=read-only`, so the session starts read-only before
`set_mode`. Constants: `SAFE_SESSION_MODE` in `stdio-client.ts`. Antigravity
has no such mode switch and is unchanged.

Claude can still reach the network through its own tools (`WebFetch`,
`WebSearch`); in `default` mode these send `session/request_permission`
(`fetch`), which the policy rejects.

### Permission policy (deny by default)

Paper text is untrusted (arbitrary PDFs and arXiv downloads), and Vellum has no
permission prompt UI yet. `requestPermission` therefore decides from
`toolCall.kind` and, for `read` and `search`, the paths the call names, in
`permission-policy.ts`:

| `toolCall.kind` | Outcome |
| --- | --- |
| `think` | Allow: selects `allow_once`, else `allow_always`; cancels if neither is offered |
| `read`, `search` | Allow (selecting only `allow_once`; cancel when it is not offered, never `allow_always`) only when every path named in `toolCall.locations[].path` and path-like `rawInput` fields (`path`, `file_path`, `paths`, `uri`, escaping globs, …) resolves inside the session cwd after `..` and symlinks (including dangling ones) are resolved, and no other `rawInput` string value, under any key and at any depth (or whitespace-separated token of one), is an absolute path outside cwd, `~…`, any `file:` URI (single slash too), a URL, or has a `..` segment. A glob that can expand to `..` (a `..` after the first wildcard, a bracket/brace group containing a dot, or a leading-dot wildcard component such as `.*/x` or `.?/x`) is rejected. A `read` that names no path is rejected. A `search` is default-denied unless it names a path inside cwd (a `{q: …}` or `{pattern: …}` search with no path is rejected). |
| `edit`, `delete`, `move`, `execute`, `switch_mode`, `other`, `fetch`, absent, `null` or unknown | Reject: selects `reject_once`, else `reject_always`; cancels if neither is offered |

`fetch` is denied on purpose. It reaches the network, so injected paper text
could use it to send the paper or other local content to an attacker, and
grounding only needs local file reads. An allow option is never selected for a
denied kind, even when it is the only option offered. Every decision is logged
as `[vellum:acp] permission backend=… kind=… decision=…` plus `reason="…"` when
a read/search was refused (override with the `onPermissionDecision`
constructor option).

### Web search (Codex)

`search` is **not** a local-only kind. Codex's native web search is reported as
`kind: search` and runs **without** a permission request, so the policy cannot
stop it; injected paper text could put paper content in a query. Vellum
therefore disables it in the adapter env (`buildAdapterEnv`, `CODEX_CONFIG`):

- `web_search = "disabled"` removes the native tool.
- `features.apps = false` is also required. With only `web_search` disabled,
  Codex fell back to the ChatGPT Apps connector tool
  `mcp.codex_apps.search_service.web_run` (kind `execute`, no permission
  request, live results returned). With `apps` off, 4 of 4 probe turns made no
  search call (3 of 3 made one with neither key set).

Both keys override the user's own `CODEX_CONFIG`. Residual risk: MCP servers the
user configured in `~/.codex/config.toml` are not touched and can still reach
the network. Claude's `WebSearch`/`WebFetch` are covered by the permission
policy (see above).

### Codex file reads are not path-scoped by the permission policy

Codex reads files by running shell commands inside codex-cli's read-only
sandbox. Its permission profile (Codex rollout `turn_context`) is
`file_system: restricted, entries: [root: read]`, so every file on the machine
is readable and Codex sends **no** `session/request_permission` for it. The
path scoping above only sees requests the adapter chooses to send (kinds
`execute`, `other`, `switch_mode`), so it cannot scope Codex reads.

codex-acp 2.2.2 sends `approvalPolicy: on-request` and a `readOnly`
`sandboxPolicy` on every turn, so Vellum cannot select `untrusted` approval,
and a restricted `default_permissions` filesystem profile in `CODEX_CONFIG` made
Codex session creation fail on the development host (the bwrap fs helper cannot
start there). Neither was shipped. Instead `buildAdapterEnv` sets
`features.shell_tool = false`, `features.unified_exec = false` and `features.view_image = false`. With both off
the tool list reported by Codex has no command runner (`apply_patch`,
MCP resource tools, goals, clock, image generation), and a
request to read an absolute path was answered "no file or shell reader exposed".

Consequences and residual risk:

- Codex grounding relies on the paper text Vellum embeds in the prompt
  (`MAX_EMBEDDED_CONTEXT_BYTES`, 512 KiB). A larger `paper.md` is only linked
  and Codex can no longer open it.
- `view_image` is disabled (`features.view_image = false`). Live probe: with it on, Codex
  read a canary PNG outside cwd with 0 permission requests; with it off the model
  has no such tool. `apply_patch` still
  exists but needs approval, which the policy rejects as kind `edit`.
- Reads by user-configured MCP servers are not scoped by Vellum.
- This was verified from the tool list and one model answer on a host where the
  Codex shell cannot run anyway (bwrap). It was not verified on a host with a
  working Codex sandbox.

### Claude settings sources

claude-agent-acp loads the user's, project and local Claude settings. Claude Code
matches their allow rules (`Read(//**)`, `Bash(*)`) before `canUseTool`, so such a
rule skipped `session/request_permission` entirely (live probe: Read and Bash
read a canary outside cwd, 0 permission lines). `session/new` now carries
`_meta.claudeCode.options.settingSources = []`, which claude-agent-acp spreads over
its default. Because sign-in on some hosts lives in the user's settings
(`apiKeyHelper`, gateway `env`) and `settingSources: []` alone made the session
fail with "OAuth session expired", `buildClaudeSessionMeta` re-supplies only
`apiKeyHelper`, `env`, `model`, `awsAuthRefresh`, `awsCredentialExport`,
`forceLoginMethod` and `forceLoginOrgUUID` from `$CLAUDE_CONFIG_DIR/settings.json`
(or `~/.claude/settings.json`) as programmatic settings. Permission rules, hooks,
plugins and MCP servers from user settings are no longer loaded. Managed (enterprise)
policy still applies.

### Session working directory

`newSession(backend, { cwd })` forwards `cwd` to `session/new`. The chat
manager, ingest extract and ingest summary pass the paper directory
(`dirname(paper.md)`), so adapters that scope file access to cwd still read
`paper.md` but not the Vellum source tree, and the permission policy scopes
`read`/`search` to it. With no `cwd` the client creates a private `0700`
`mkdtemp` directory for that session and removes it on dispose (or on a failed
handshake). It never uses `process.cwd()` or the shared OS temp dir. The adapter
process is also spawned with the session cwd as its process cwd (sessions are one
process each), so relative paths resolve there and project config is not read from
the app's checkout.

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
npm run smoke:acp -- antigravity  # just agy acp
```

Requires the adapter CLI(s) actually installed and signed in to your
Claude Pro/Max or ChatGPT plan. This is **not** part of `npm test` / CI — it's
a separate, honest check of the real sanctioned-plan path. See `smoke.ts`.

Smoke output is sanitized and compact: UTC start/end times, streamed text,
update kinds, and terminal stop reason. Adapter diagnostics remain on stderr.

If a service rollout selects a model newer than the installed adapter runtime,
set `VELLUM_CODEX_MODEL` to a model supported by that runtime while upgrading
the adapter. Vellum trims the value and delivers it through
`CODEX_CONFIG.model`, the documented runtime interface in
`@agentclientprotocol/codex-acp` 2.2.2. Existing JSON object keys survive;
the override replaces an existing `model` key. Vellum copies the environment
without changing the caller's values. Invalid or non-object `CODEX_CONFIG`
fails before spawn with a fixed error that excludes config contents.

```bash
VELLUM_CODEX_MODEL=gpt-5.5 npm run smoke:acp -- codex
```

An absent or blank override leaves `CODEX_CONFIG` untouched. Claude receives
no model override. Vellum also retains `-c model=<JSON-encoded value>` as one
argv entry for legacy adapter compatibility, without invoking a shell.
Current 2.2.2 server entry ignores arbitrary argv and reads `CODEX_CONFIG`.
No provider, authentication, or service-tier default changes. Vellum does force
the session mode and Codex web-search limits described above.
See [issue #136 verification](../../docs/verification/issue-136.md) for
official source locations, delivery evidence, and live verification limits.

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
