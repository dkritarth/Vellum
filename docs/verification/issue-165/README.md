# Loaded-note save and Clear recovery

Issue #165, tested 2026-11-06 on Linux/xvfb, Node 24.19.0 and Electron 32.3.3. Stack base is #164 at `c396fbf250118f3340ca11897410390f437fecc2`, above #98.

## Behavior and regression proof

Current loaded-note save failure now announces that the note was not saved, retains the unsaved draft, and offers **Retry save**. Clear failure restores the exact draft from before Clear and offers **Retry Clear**. Repeated failure remains visible. Successful retries report Saved or Cleared. Typing removes obsolete error/retry intent and schedules the latest draft normally. Generation and revision guards retire obsolete results, including results from earlier visits to the same paper.

The state remains local to NotesPanel. Save and Clear errors are distinct from initial-read errors. No backend, preload, schema, dependency, generic mutation framework or disk serialization changes. Existing CSS supports the messages and native buttons; no CSS change needed.

[Red](red.txt) records 2 failing public-component cases and 28 passing existing tests before implementation. Both failures were missing accessible alerts. [Baseline cases](baseline-regressions.txt) preserve the supplied repro, with its import made relative. To repeat against the pinned base, copy that text to `src/app/NotesPanel.repro.test.tsx` in a separate disposable checkout, run that test, then remove the copied file. The baseline cases use a rejecting bridge stub; their static stored-text value is illustrative, not evidence of real disk behavior.

Final regression tests replace those initial minimal cases with fuller behavioral coverage. [Focused green](green.txt): 35 tests. [Full suite](tests.txt) and [post-restoration suite](tests-restored.txt): 403 tests across 41 files. [Typecheck](typecheck.txt), [build](build.txt), and `git diff --check` pass. Existing Reader jsdom canvas-not-implemented stderr remains in full-suite logs.

## Live Electron verification

[Reproducible production harness](live.mjs), [results and renderer console](live-results.json), and [run output](live-run.txt) cover actual visible controls, clicks and keyboard input with Attention Is All You Need and BERT:

- Start-empty placeholder, Create / Add Paper ingestion, real PDF canvas/text, true empty editor, normal autosave.
- Hold save, type research through keyboard, reject save, retain editor focus/draft and verify old note remains stored. Tab reaches Retry save; Enter retries. Repeated failure remains visible. Successful retry persists the same draft without another edit.
- Close and relaunch the entire process immediately after save recovery. Recovered draft and unrelated B note/history remain.
- Type an unsaved draft, Clear before debounce, reject delete. Exact unsaved draft returns. Keyboard retry fails again without claiming success.
- Type after failed Clear. Retry Clear disappears. Reject the subsequent save; Retry save persists latest text without another deletion.
- Reject Clear again, then keyboard retry successfully runs production delete. Cleared appears, editor is empty, bridge returns no note. Immediate process restart retains deletion.
- Hold and reject save and Clear after switching to B through visible paper tabs. Late failures cannot alter B or show obsolete errors. Revisiting A reads persisted text.
- Hold/reject an initial read. Note and Clear stay disabled; distinct keyboard Retry reloads saved text.
- Quick Notes unmount through Details flushes a pending loaded edit. Final normal save and full restart preserve final A note, unrelated B note, chat session/message and byte-identical paper PDFs.
- Four production launches, zero captured renderer errors, warnings or page errors.

Screenshots inspected: [save error](save-error.png), [save recovery](save-recovered.png), [save restart](save-restart.png), [Clear error](clear-error.png), [Clear recovery](clear-recovered.png). Errors wrap within the existing Notes panel and Retry remains visible. Existing PDF text overlay defect #86 remains visible and outside scope.

Separate [development smoke](dev-smoke.mjs), [output](dev-run.txt), [console](dev-console.txt), and [process log](dev-process.txt) exercise `npm run dev`, visible real-paper ingestion, editor focus, typing/save, and Clear. No renderer errors/warnings/page errors. Process log includes GPU initialization failure and DBus `NoReply`. Development teardown uses process-group SIGTERM; graceful shutdown durability is not certified.

Isolated production data retained at `/data/dandapat/.tmp/vellum-165-vTp6N5`; development data at `/data/dandapat/.tmp/vellum-165-dev-ktk1Ib`. These local inspection paths are not durable remote evidence. Both adapters were shadowed with exit-127 executables. No personal data/config, credentials or model calls used. Unrelated history was seeded directly in isolated SQLite, then preserved session data checked through the bridge and message content checked in SQLite.

## Injection and limits

The harness retains production IPC handlers through Electron 32's private `_invokeHandlers` map, as demonstrated by #164. A selected operation is held. Rejection throws an injected error without executing its production handler. Successful release invokes the retained production handler. Other calls use production handlers normally. Thus the live run checks actual persisted save/delete recovery while deterministically controlling rejected/delayed operations. This verification-only code may require changes with another Electron major.

Natural SQLite/storage failures and their incidence, saves during process shutdown, and reordered disk commits remain unverified. Generation/revision checks govern renderer state, not disk commit order. Outgoing flush remains best effort. No cross-navigation failed-draft store or navigation confirmation was added. No signed-in ACP claim.

Paper sources and SHA-256:

- Attention Is All You Need, <https://arxiv.org/pdf/1706.03762>, `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
- BERT, <https://arxiv.org/pdf/1810.04805>, `5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e`.

## Reproduction and native module handling

```bash
npm ci
npm test -- src/app/NotesPanel.test.tsx
npm test
npm run typecheck
npm run build
cp node_modules/better-sqlite3/build/Release/better_sqlite3.node /tmp/vellum-165-host.node
npx electron-builder install-app-deps
xvfb-run -a node docs/verification/issue-165/live.mjs /path/attention.pdf /path/bert.pdf
xvfb-run -a node docs/verification/issue-165/dev-smoke.mjs /path/attention.pdf
# Stop all verification Electron processes before restoring; do not overlap Node tests.
cp /tmp/vellum-165-host.node node_modules/better-sqlite3/build/Release/better_sqlite3.node
cmp /tmp/vellum-165-host.node node_modules/better-sqlite3/build/Release/better_sqlite3.node
npm test
git diff --check
```

[Native hashes](native.txt) match exactly before rebuild and after restoration: `45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`. [Rebuild output](native-rebuild.txt). No Node tests overlapped native rebuild or Electron verification. Final suite passed after restoration.

## Self-review

Local review against pinned #164 base, per explicit no-subagents instruction.

Standards: no findings. Renderer still uses the typed allowlisted bridge. Operation-specific recovery stays inside NotesPanel, reuses existing styling, and adds no dependency or backend behavior.

Specification: no findings. Current save/Clear errors, repeated retry/recovery, new-edit supersession, stale generation/revision results, initial-read distinction, normal debounce/flush, real-paper live checks and immediate recovery restarts covered. Existing #98/#164 tests pass. Independent parent review and CI remain pending. Draft only; no merge, watch, label changes or phase unlock.
