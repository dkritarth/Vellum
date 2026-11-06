# Issue #145 verification

Base: `f69a27e2f33db92260a642bbb1b05e6ba4ee6267`, PR #126 on #97.
Branch: `fix/145-chat-delete-state`. Verified 2026-11-05.

## Ownership and behavior

Requested target means the chat selected from Chats. Displayed session means
Ask's current durable chat, which can differ after New chat. Successful deletion
means the existing delete IPC fulfilled; cancellation/rejection emits no notice.

ChatsList notifies App after successful deletion, before list refresh. App retains
deleted IDs across Ask tab remounts; IDs are never reused. Typed props carry these
tombstones to Ask, which owns displayed-session invalidation. Only deletion of the
displayed session reopens it. Pending opens discard deleted snapshots; explicit
deleted targets fall back to default open. Reopening clears history/draft and
invalidates outgoing starts/New chat by generation. No event bus or IPC changes.

## Regression and checks

Authorized public seams: existing App and AskPanel interfaces with preload mocks.

- Red: both App regressions failed on old code, still displaying deleted history;
  default-current and explicit-target cases. Nine other App tests passed.
  `/tmp/vellum145-red.log`.
- Green: next Send uses replacement ID 2. Unrelated/cancelled/rejected deletions
  preserve history/draft. Coverage includes a newer displayed chat differing from
  target, remount, late open/start/turn results, and outgoing deletion after a
  paper switch. Existing ownership tests remain intact.
- Final `npm test`: 41 files, 413 tests passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Logs: `/tmp/vellum145-tests-final.log`,
  `/tmp/vellum145-typecheck-final.log`, `/tmp/vellum145-build-final.log`.

## Live Electron evidence

Playwright Electron under Xvfb with fresh isolated data and application profile.
Real *Attention Is All You Need* PDF (2,215,244 bytes), extracted markdown, seeded
metadata through existing store interface. Ingest itself was not exercised.

First run exercised built renderer. Second exercised development renderer from
`npm run dev -- --rendererOnly --noSandbox`, with an isolated instrumented Electron
main bundle. Generated bundle copy overrides only ACP transport, seeds paper
metadata, and supports explicit delayed-open/rejected-delete fault injection.
Production source/IPC/database deletion semantics were not changed. No credentials
or ACP subprocess used. Temporary bundle removed after each run.

Clicked Library, paper, Chats, conversation rows, delete buttons and native
confirmation. Typed prompts and clicked Send. Results:

- Default-current chat 1 deletion clears old history, creates chat 2, next Send succeeds.
- Explicit chat 2 deletion loads remaining chat 3; next Send succeeds there.
- Cancel preserves current draft/history.
- Deleting unrelated chat 3 preserves displayed chat 4 and draft.
- Injected delete rejection preserves chat 4 and draft; existing console-only
  mutation feedback remains #113's separate scope.
- Delayed reopening disables input; empty chat becomes usable when open settles.
- Input label, delete labels, and keyboard focus from input to Send checked.
- Restart leaves only chat 4, restores its history, and accepts another Send.
- Renderer: no unexpected warnings/errors/page errors. Injected rejection produced
  expected existing console error. Main stderr contains headless GPU/DBus warnings;
  these are not represented as a clean main console.

Built evidence: `/tmp/vellum145-live-6ueNE9/`.
Development/fault-injection evidence: `/tmp/vellum145-live-92N8TJ/`.
Both contain `result.json`, `renderer.log`, `main.log`, `transport.jsonl`, and screenshots.
Development screenshots: `empty.png`, `loading.png`, `after-selected-delete.png`,
`unrelated-preserved.png`, `rejected-delete.png`, `restart.png`.
Script/log: `/tmp/vellum145-live.mjs`, `/tmp/vellum145-live-dev.log`.
Artifacts are local, not uploaded. Selected-delete screenshot visually inspected.

Electron native binding was backed up before rebuild and restored before final
Node tests. Backup/restored SHA-256:
`45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`.
No test run overlapped native rebuild.

## Self-review and limits

Reviewed full diff against issue #145 and AGENTS/CLAUDE standards, including narrow
callback ownership, successful-delete timing, tombstone remount behavior,
generation guards, preservation of unrelated drafts, and renderer isolation.
No remaining standards/spec findings. No subagents or independent review.
Repository lacks `docs/agents/issue-tracker.md`; issue fetched directly with `gh`.

No signed-in ACP verification or smoke run: no ACP production change. Deterministic
answers prove UI/session routing and persistence, not grounded model quality.
Actual deletion during a running backend turn was not exercised live; UI regression
covers late completion without resurrection and preserves paper-wide active-turn
locking. Backend policy for deleting an active turn remains a separate concern:
this change does not cancel/dispose backend work or change persistence policy.
Existing PDF text-layer overlap remains visible (#86). No phase unlocked or merge.
