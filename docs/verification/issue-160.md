# Issue #160 verification

Scope: explicit `cancelled`, `max_tokens`, `max_turn_requests` only. Pinned base
`f69a27e2f33db92260a642bbb1b05e6ba4ee6267` (#126), stacked on #97. Original
prepared branch pointed elsewhere; created focused branch from pinned base,
preserving original branch and clean checkout. No parent checkout edits.

## Contract research

Primary source: installed `@agentclientprotocol/sdk` 1.2.1,
`schema/schema.json`, `StopReason` definition (line 4438).
[Official stop reasons](https://agentclientprotocol.com/protocol/prompt-turn#stop-reasons):
`end_turn` means success; `max_tokens` means token limit; `max_turn_requests`
means allowed request limit; `cancelled` confirms cancellation. `refusal` has
separate next-prompt exclusion semantics; outside this patch.

`core/acp/stdio-client.ts` forwards `res.stopReason` in `done` updates. Installed
first-party `@agentclientprotocol/codex-acp` 2.2.2 `dist/index.js` has
`cancelledPromptResponse` paths, including turn cancellation. Limits are
protocol-valid; no measured assertion that this adapter emits either limit.
No transport edits or personal configuration/credential inspection.

Original public-interface reproduction and research:
`/tmp/vellum-chat-terminal-repro/{repro.test.ts,result.log,research.md}`.
Three cases save `The evidence is` as completed and retain cached session.

## Red / green and checks

Regression through public ChatManager and ACP interfaces, real in-memory SQLite.
Each case first completes a turn, streams partial on cached session, then emits
one incomplete reason. Asserts error without done, no partial persistence,
completed history and saved question preserved, disposal, no automatic retry,
released guard, fresh-session explicit retry with correct recap, successful
`end_turn`, and successful-turn usage records.

- [Red log](issue-160/red.log): 3 failed / 21 passed; expected `error`, received `done`.
- [Focused green](issue-160/focused.log): 24 passed.
- Full `npm test`: 41 files, 404 tests passed (`/tmp/vellum160-tests.log`).
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Production diff: 9 added manager lines; three parameterized regressions.

Test initially selected oldest usage row with `.at(-1)`; corrected to documented
newest-first result. Original red failure precedes usage assertion. No production
change needed for telemetry. Existing usage/session identity/error tests pass.

## Isolated live Electron

Harness: [live.mjs](issue-160/live.mjs). Run from checkout after `npm run build`:

```bash
# Before rebuilding, back up this checkout's Node better_sqlite3.node.
npx electron-rebuild --force --only better-sqlite3
VELLUM_TEST_PDF=/absolute/path/to/attention.pdf xvfb-run -a node docs/verification/issue-160/live.mjs
# Restore backed-up Node binding byte-for-byte before Node checks.
```

No checks run concurrently with native rebuild. Own binding restored via `cp`
and verified with `cmp`; SHA-256
`45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`.

Playwright controls actual Electron window under Xvfb, normal sandbox settings,
unique data directory and fresh profile. Preview rejected `file:` URL with
`unsupported-protocol: file:`. Built bundle copy injects deterministic
`StdioAcpClient.newSession`, retaining production manager, IPC, renderer, and DB.
Injected text then waits 900ms before terminal reason. Records requests/disposal.
Temporary bundle removed on exit. No ACP subprocess during injected UI run.

Seeded actual *Attention Is All You Need*: 2,215,244 PDF bytes, 39,605 extracted
characters; SHA-256
`bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
Second paper entry uses same test PDF as preservation sentinel. Ingest and actual
agent paper reading/grounding are not exercised.

Clicked Library, paper title, Ask. Typed separate sentinel history; clicked Notes,
typed note and observed Saved. Opened research paper, checked empty state,
selected Codex through Model backend, completed history, renamed via existing
bridge. New chat for each reason; typed BASE then FAIL question, clicked Send.
Observed partial while input disabled; then reason-specific alert, partial gone,
question/history retained, input enabled and empty. Focused input, typed RETRY,
Tabbed to Send and clicked. Alert cleared, two completed replies displayed.
Recorded retry uses fresh session, recaps prior completed answer and failed user
question, excludes partial. No automatic retry.

Reopened earlier chat through visible Chats row; history preserved. Opened other
paper; history and note preserved. Closed app, relaunched same isolated data/profile,
reopened all three terminal chats and earlier chat; questions/retries/completed
answers persisted, partial absent. Other-paper history/note preserved after restart.

First harness attempt completed terminal cases but hit ambiguous locator on
other-paper history. Narrowed locator and reran full journey successfully. Initial
sentinel PDF location mismatched slug; corrected isolated seed before final run.

Renderer console/page errors: `[]`. Main process recorded GPU process initialization
errors and D-Bus `NoReply` under Xvfb on both launches; no app exception observed.
Screenshots inspected: error, partial, retry and restart; existing PDF text-layer
overlap remains visible (#86). Local harness/logs/screenshots also under
`/tmp/vellum160-live-*`; selected evidence committed beside this note.

## First-party smoke and limits

Ran exact requested command-local environment:

```bash
env -u DEFAULT_AUTH_REQUEST -u OPENAI_API_KEY -u CODEX_API_KEY MODEL_PROVIDER=openai CODEX_CONFIG='{"model":"gpt-6.1-sol","service_tier":"default"}' INITIAL_AGENT_MODE=read-only npm run smoke:acp -- codex .
```

[Smoke output](issue-160/smoke.log): first-party Codex starts, returns
`workspace routing discovery unauthorized (401)`, then `end_turn`; **no pong**.
Old script prints misleading VERIFIED banner (#138). Signed-in inference remains
**unverified**. Trailing `.` is parsed as second backend; that iteration fails
`Cannot read properties of undefined (reading 'command')`; overall exit 1.
No personal config/authentication changes; no raw key path; default service tier.

Existing Ask error path drops transient partial bubble without persistence. No
incomplete-message representation added. Failed-turn usage follows existing error
policy (no successful usage record); normal end_turn usage unchanged. Retry is
explicit new user action; failed question remains in recap. Refusal handling,
silent EOF/disposal (#110), schema/status/UI redesign remain outside scope.

## Self-review

Inline standards and issue-contract review, per explicit no-subagent instruction.
No remaining findings. Checked exact three-reason classification before usage/save,
existing catch eviction before error, guard release, chat identity ownership from
#126, prior history/question recap, no automatic resubmission, unchanged refusal
and transport, type boundaries and focused diff. No independent review claimed.
Issue already claimed `status:in-progress`; no labels changed, merge, watch or unlock.

Final Codex-selected run: `/tmp/vellum160-live-ELxVhG`, PASS.
Cancelled failed/retry session IDs `3/4`, token limit `5/6`, request limit `7/8`.
Native binding restore and 24 manager tests passed again after final Electron run.

- [Streaming partial](issue-160/max_turn_requests-partial.png)
- [Cancellation error](issue-160/cancelled-error.png)
- [Token limit error](issue-160/max_tokens-error.png)
- [Request limit error](issue-160/max_turn_requests-error.png)
- [Explicit retry](issue-160/max_turn_requests-retry.png)
- [Restarted chat](issue-160/max_turn_requests-restart.png)
- [Restarted other-paper note](issue-160/restart.png)
- [Recorded requests/disposals](issue-160/transport.jsonl), [result](issue-160/result.json)
- [Renderer console](issue-160/renderer.log), [main console](issue-160/main.log)
