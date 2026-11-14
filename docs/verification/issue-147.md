# Issue #147 verification

Base: `ff3183acab832fced8c3f88c5e379138d45264ed`.
Branch: `fix/147-chat-navigation-ownership`. Verified 2026-11-05.
Stack: this draft on #146, on #126, on #97. Target `fix/145-chat-delete-state`.

## Ownership

App owns requested navigation and committed paper/chat selection. Each chat lookup
receives a distinct request identity, including repeated clicks on the same chat.
Only the current request can commit its paper and durable chat ID, or its error.
Pending lookup leaves the displayed conversation and draft intact. React batches
the successful paper/chat updates. Direct view/paper/tab navigation revokes the
request; switching papers clears the old explicit chat target. Same-paper tabs
preserve it. Successful deletion revokes only a matching pending request and keeps
#146's tombstones. No new public seam, domain term, backend, or reader change.

## Automated evidence

Public App interface authorized by task: real Sidebar/ChatsList/RightPanel/AskPanel
with preload adapter doubles. PDF.js mocked for jsdom only.

- Red A/B regression before implementation: late A makes B's tab unselected.
  `/tmp/vellum147-red-race.log`. Initial request guard green: 12 App tests.
- Direct-navigation red: stale success reopens A; missing/rejected result sets an
  unwanted banner. `/tmp/vellum147-red-navigation.log`. That run also exhausted a
  worker because the deletion double returned deleted IDs forever. Corrected the
  double to model replacement sessions; clean base replay then independently fails
  pending-target deletion: `/tmp/vellum147-red-deleted.log`.
- Green: 38 App tests, including reverse order, pending target alignment and Send,
  direct paper/tab/Library/Home/Trash/Usage with stale success/miss/rejection,
  current-error recovery, newer-banner preservation, and pending-target deletion.
- Final `npm test`: 41 files, 440 tests pass, including existing deletion,
  draft/history, outgoing completion, and paper-wide turn-lock regressions.
  `/tmp/vellum147-tests-final.log`.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
  `/tmp/vellum147-typecheck-final.log`, `/tmp/vellum147-build-final.log`.

## Live Electron evidence

Playwright Electron under Xvfb, fresh isolated app data/profile. Actual PDFs and
extracted markdown: Attention Is All You Need (2,215,244 bytes) and Less Than
One-Shot Learning (3,542,378 bytes). Metadata/history seeded via existing store
functions; ingest was not exercised.

Development renderer launched with `npm run dev -- --rendererOnly --noSandbox`.
Separate instrumented main-bundle copy queues deterministic `getPaper` responses,
records Ask open/start parameters, and replaces ACP transport with deterministic
text. Renderer, preload, storage, deletion, and Ask IPC validation remain real.
No production source instrumentation, credentials, or ACP subprocess. Generated
main copy removed on exit. Development StrictMode duplicate opens are allowed;
every open must have the correct paper/session pair.

Both development and built renderer runs clicked Chats options A then B, released
B then A, and kept B selected. Paper/tab/Library navigation survived stale
success/missing/rejection. Current errors stayed visible; retry recovered and Send
used the correct durable chat ID. Stale rejection preserved the newer banner.
Pending target deletion preserved B and its draft. Same-paper tab preserved draft;
cross-paper tab dropped the previous explicit target. Empty initial view, usable
pending state, input/delete labels, input-to-Send keyboard focus, and restart
history/deletion persistence checked. Built run additionally waited for Reader to
settle and checked B's PDF text and screenshot against B's active tab/Ask history.

Artifacts, each with result JSON, parameter trace, renderer/main logs, screenshots:

- Development: `/tmp/vellum147-live-2q3887/`.
- Built: `/tmp/vellum147-live-VbOQWB/`.
- Script: `/tmp/vellum147-live.mjs`; logs `/tmp/vellum147-live.log`,
  `/tmp/vellum147-live-built.log`, `/tmp/vellum147-dev.log`.
- Screenshots: `empty.png`, `reverse-completion.png`, `current-missing.png`,
  `current-rejected.png`, `pending-preserved.png`, `deleted-pending.png`, `restart.png`.
  Built reverse-completion and development rejection screenshots visually inspected.

Renderer errors/warnings/page errors: none. Main stderr includes headless GPU
initialization/DBus errors, expected injected lookup rejection traces, and debugger
shutdown notices. Preview could not open the app; Electron control used instead.
Native SQLite binding was privately backed up, rebuilt for Electron, and restored.
Restored SHA-256: `45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`.
No tests overlapped rebuilds. Initial dependency install hit full disk; final runs
used a complete private install after space became available.

## Review and limits

Local standards/spec review against the pinned base and full #147 contract found
no remaining findings in this diff. Reviewed request ownership, atomic target
commit, stale errors, direct navigation, successful-delete timing, draft preservation,
renderer isolation, and scope. No subagents or independent review. Issue fetched
with `gh`; repository has no `docs/agents/issue-tracker.md`.

No signed-in ACP smoke or grounded-model quality claim. Fault injection proves
routing, not natural IPC timing frequency. Collection/back-link navigation routes
through the same invalidation helper but was not independently exercised live.
Artifacts remain local. Existing PDF text-layer overlap is #86. Discovered separate
follow-ups: #148 old PDF pixels during loading; #149 vertical error banner and its
unlabeled dismiss control. Neither fixed here. No merge, watch, or phase unlock.
