# Issue #124 verification

Base: PR #97, `t3/fix-ask-switch-state` at
`5a64cb8708e9366776a39e9d56f70d341c7da769`. Verified 2026-11-05.

## Regression and checks

Public seams: `ChatManager.openChat`, `newChat`, `runTurn`, `disposeAll`,
and the injected `AcpClient` transport. Real in-memory SQLite, no private access.

- Before fix: A/B/A/B regression failed, expected four ACP conversations,
  received two; 16 existing tests passed. Log: `/tmp/vellum124-red.log`.
- After fix: 21 manager tests pass. A/B/A/B runs for Claude and Codex.
  Covers selected history only, separate durable messages, same-chat reuse
  without repeated recap, disposal, switch spawn failure/retry, backend separation,
  paper-wide lock during switch disposal, and existing ownership tests.
- `npm test`: 41 files, 401 tests pass.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
- Logs: `/tmp/vellum124-focused.log`, `/tmp/vellum124-tests.log`,
  `/tmp/vellum124-typecheck.log`, `/tmp/vellum124-build.log`.

## Isolated Electron procedure and results

Playwright Electron under Xvfb, normal Electron sandbox settings, built bundle,
unique `VELLUM_DATA_DIR` and fresh Playwright application profile. Preview could
not open Electron's `file:` URL. No personal browser session used.

Seeded actual *Attention Is All You Need* PDF and metadata through the existing
store interface, with `unpdf` text extraction. PDF: 2,215,244 bytes; markdown:
39,605 characters; SHA-256:
`bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
This checks navigation and chat persistence; ingest was not exercised.

An ad-hoc generated-bundle copy overrides `StdioAcpClient.newSession` with a
recording deterministic transport. Production source, IPC, SQLite behavior, and
renderer remain unchanged. No ACP subprocess or credentials used. Temporary
bundle removed; Node SQLite native binding restored after Electron verification.

Clicked Library, paper title, Ask. Typed `ALPHA original`, clicked Send, renamed
chat A through existing bridge. Clicked New chat, observed empty thread, typed
`BETA original`, renamed B through bridge. Clicked Chats and A/B rows to reopen;
typed follow-ups in both, then another B follow-up. Recorded chat conversation
IDs were `[1, 2, 3, 4, 4]`. A recap included ALPHA only, B recap included BETA only;
last B request omitted recap. Visible threads excluded the other chat's text.
Input focus verified. Closed app, relaunched with same isolated data, reopened A,
confirmed persisted ALPHA follow-up with no BETA text. Captured renderer console
and page errors: `[]`. Main-process console was not separately captured.

Local evidence, not uploaded: `/tmp/vellum124-live.mjs`,
`/tmp/vellum124-live.log`, `/tmp/vellum124-transport.jsonl`,
`/tmp/vellum124-chat-b.png`, `/tmp/vellum124-restart-a.png`.

## Review and limits

Self-review against issue and repository standards found no remaining findings.
Checked eviction before spawn, cache-map reacquisition after disposal, spawn
failure leaving no stale conversation, lock scope, disposal, and unchanged
public interface. No subagents or independent review. Issue contract fetched
directly with `gh`; repository lacks `docs/agents/issue-tracker.md`.

Signed-in Codex remains unverified. `npm run smoke:acp -- codex` was not run:
available CLI configuration selects a non-first-party provider. Did not use that
route, change personal configuration, or weaken sandbox/authentication. Live
spawn-failure/retry UI was not exercised; manager regression covers it.
Existing PDF text-layer overlap remains visible, tracked by #86. Fresh
conversation startup on chat switches can incur adapter cold-start latency.
