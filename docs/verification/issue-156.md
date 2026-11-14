# Issue #156 verification

Base: `ff3183acab832fced8c3f88c5e379138d45264ed`.
Branch: `fix/156-chat-query-ownership`. Verified 2026-11-06.
Stack: this draft on #146, on #126, on #97. Target `fix/145-chat-delete-state`.

## Ownership and behavior

Each mounted search effect owns its requests. Effect cleanup revokes publication
and clears its interval. A request counter permits only the latest request in that
effect to publish rows, errors, or completed loading. Changing search clears the
previous rows/error and starts loading. Polls retain current rows while pending.
The refresh ref points to the mounted search effect, so a deletion finishing after
a search change refreshes the current search. After unmount the ref is null.
Successful deletion still notifies App once, before refresh, preserving #145.
No backend, preload, ACP, schema, visual, or keyboard contract changed.

## Automated evidence

Authorized seam: rendered ChatsList through its public props and typed preload API.

- First stale-success regression failed before implementation:
  `/tmp/vellum156-red-success.log`. It passed after the first fix:
  `/tmp/vellum156-green-success.log`.
- Expanded regressions replayed against the pinned base: 10 failures, 7 passes.
  `/tmp/vellum156-red-all.log`. Replay restored the fixed source afterward.
- Green focused suite: 17/17. `/tmp/vellum156-focused.log`.
  Covers stale query success/error/loading, query loading reset, overlapping polls,
  newer error preservation and recovery, repeated search, unmount/remount,
  deletion during search change, exactly-once notification, and deletion after unmount.
- `npm test`: 41 files, 425 tests passed. `/tmp/vellum156-tests.log`.
- `npm run typecheck`: passed. `/tmp/vellum156-typecheck.log`.
- `npm run build`: passed. `/tmp/vellum156-build.log`.
- `git diff --check`: passed.

## Live Electron evidence

Playwright Electron under Xvfb with fresh isolated data and user-data profiles.
Real *Attention Is All You Need* PDF, 2,215,244 bytes, plus extracted markdown.
Paper metadata, two chat histories, a note, highlight, collection, and membership
seeded through existing store functions. Ingest itself was not exercised.

Development renderer launched through `npm run dev -- --rendererOnly --noSandbox`
with an isolated temporary config on port 5186 and idle Electron entry. Actual test
Electron processes use the real preload and renderer. A separate generated main
bundle queues only chat-list replies and deletion completion. Each queued reply
captures actual SQLite results when requested. Poll snapshots differ through real
rename IPC. Deletion still executes the production delete function after release.
A snapshot helper reads only isolated test research state. ACP session creation is
replaced with a deterministic unused session whose prompt throws, so this harness
cannot invoke signed-in ACP. No credential/config access or production source edits.
The generated main copy uses the existing Electron binding at its absolute path.

Actual clicks and typing verified:

- Older query success/rejection preserves newer Beta search and results.
- Old completion cannot clear the newer query's loading state.
- Older poll success/rejection cannot replace a newer poll snapshot.
- Current failure is visible; old success cannot dismiss it; next poll recovers.
- Empty results retain search focus. Tab reaches the labeled result option.
- Files/Chats toggle unmounts and remounts the list; late rejection cannot publish.
- Alpha deletion held while search changes to Beta. Completion requests only Beta.
  Beta history and typed unsent draft remain intact.
- Restart retains Alpha deletion and Beta history. Paper metadata, note, highlight,
  collection, membership, Beta session/messages, PDF and markdown remain unchanged.

Development artifacts: `/tmp/vellum156-live-9fVfyY/`.
Initial built artifacts: `/tmp/vellum156-live-OG293v/`.
Each includes `result.json`, `trace.json`, `renderer.log`, `main.log`, and screenshots:
`initial.png`, `obsolete-success.png`, `loading.png`, `poll-success.png`,
`current-error.png`, `empty.png`, `pending-delete.png`, `restart.png`.
Harness: `/tmp/vellum156-live.mjs`.
Dev server setup: `out/issue156.config.mjs`, `out/main/idle156.cjs` during verification.
Logs: `/tmp/vellum156-dev-isolated.log`, `/tmp/vellum156-live-built.log`.
The first dev log was interleaved with an earlier harness failure; use the passing
artifact directory's result/trace/logs as authoritative evidence.
All artifacts remain local. Dev deletion and built current-error screenshots
visually inspected. Final built artifacts with Reader text-layer checks before deletion/restart
screenshots: `/tmp/vellum156-live-01bDuT/`. All ten scenarios passed again.
Final built log: `/tmp/vellum156-live-built-final.log`.
Final built deletion screenshot visually inspected with real paper rendered.

Renderer errors/warnings/page errors: none in successful runs. Main stderr contains
headless GPU/DBus notices, expected injected chat-list rejection traces, and debugger
shutdown notices. Main console is not represented as clean.

No native rebuild was needed: this checkout already has separate Node and Electron
bindings. Their SHA-256 hashes remained unchanged before and after live runs:

- Node: `45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`.
- Electron: `0f821f4f188511a3a5c757466ec7af092999c932c8ecb39d942899f499a9da23`.

No test run overlapped any rebuild.

## Reproduce

From this checkout after installing dependencies and building, provide the real PDF
at `/tmp/vellum-121-attention.pdf`, then run:

```bash
LIVE_RENDERER_URL=built xvfb-run -a node /tmp/vellum156-live.mjs
```

The harness creates fresh data/profile directories, instruments a temporary main
bundle, clicks/types through the full sequence, closes Electron, and removes that
bundle. No dependency rebuild is required when the existing Electron binding works.
Development mode uses the same harness with `LIVE_RENDERER_URL` unset and this
checkout's isolated development renderer running on port 5186.

## Self-review and limits

Reviewed standards and spec separately against the pinned base and full #156 body.
Checked effect cleanup, newest-request guards in success/catch/finally, search
resets, delete notification order, refresh after search change/unmount, preservation
of unrelated state, renderer isolation, test validity, and narrow file scope.
No remaining standards/spec findings. No subagents or independent review, per task.
Issue fetched with `gh`; repository has no `docs/agents/issue-tracker.md`.

No signed-in ACP smoke or grounded-model claim. Seeded histories verify actual
SQLite/IPC/UI persistence, not a live model turn. Fault injection proves response
ordering behavior, not its frequency in normal IPC. Existing broader keyboard and
mutation-feedback ownership in #106/#113 remains outside this patch. Request
revocation ignores stale completions; it does not cancel backend work. No merge,
issue closure, phase unlock, or independent live gate claim.

Known Reader limitation: existing PDF text-layer overlap (#86) remains visible in
first-page screenshots. The harness checks real first-page text, not completion of
all Reader pages or PDF visual correctness. Harness and dev helpers archived at
`/tmp/vellum156-live-01bDuT/harness.mjs`, `dev-config.mjs`, and `dev-idle.cjs`.
