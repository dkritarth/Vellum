# Note callback ownership verification

Issue #92, based on master `757b5f8`. Tested 2026-10-23 with Node 24.19.0 and Electron 32.3.3 on Linux under xvfb. The interrupted Vellum2 checkout was inspected and copied read-only; its files remain untouched.

## Failing before, passing after

The first deferred Clear regression failed on unchanged production code. B's editor contained `A original` instead of `B edited`; navigation then called `notesSave({ slug: 'p2', body: 'A original' })`. After the Clear guard, all 13 tests passed.

The next slice reproduced stale autosave success/failure changing a newer save's `Saving…` status, and an outgoing flush rejection marking B dirty. Three tests failed before save/flush guards; all 18 passed afterward. Added normal failure recovery and A-B-A visit coverage. Final focused suite: 23 passed. Full suite: 391 passed across 41 files. Typecheck, production build and whitespace checks passed. Existing jsdom canvas-not-implemented stderr remains in Reader unit tests; real PDF canvases and text rendered in Electron.

## Live Electron evidence

`test/notes-async-live.mjs` exercises visible controls and real files in isolated paper/database, Chromium configuration and cache directories. It shadows both ACP adapters with failing local executables, so no signed-in session or subscription is used. Metadata therefore falls back to local paths.

Two public papers were downloaded and ingested through Create / Add Paper:

- Attention Is All You Need, <https://arxiv.org/pdf/1706.03762>, SHA-256 `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
- BERT, <https://arxiv.org/pdf/1810.04805>, SHA-256 `5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e`.

Passed two production Electron runs, each with a full process restart:

- Notes empty state, accessible Note label, keyboard focus, actual paper rendering, typing and debounced autosave.
- Delayed Clear(A) rejection after switching to and editing B. B retained its text and flushed it under B's slug. A retained its original persisted note.
- Current Clear rejection restored its original note and allowed the normal outgoing retry.
- Delayed autosave success and failure after switching papers preserved B's newer editor and Saved status.
- Outgoing flush failure did not dirty B, clear Saved status or cause a redundant B save.
- Normal Clear deleted the persisted note, disabled the empty action and allowed another edit.
- Full Electron restart preserved distinct A/B notes, opened again through Library and paper controls.
- Zero renderer console errors, warnings or page errors across both launches.

[Clear failure isolation](clear-failure-isolated.png) shows B's retained text. [Restart persistence](restart-two-papers.png) shows the restored B note with both paper tabs open. [Machine-readable results](live-results.json) list the cases. The PDF text-layer alignment defect visible in screenshots is existing #86, outside this change.

## Reproduction and limits

```bash
npm ci
npm test -- src/app/NotesPanel.test.tsx
npm test
npm run typecheck
npm run build
npx electron-builder install-app-deps
xvfb-run -a node test/notes-async-live.mjs /path/attention.pdf /path/bert.pdf
git diff --check
```

Install dependencies in an isolated worktree before the Electron rebuild. The rebuild changes that checkout's native SQLite binary. Rebuild it for the host Node runtime before subsequent Node-based store tests.

Reply control runs only inside the verification script. It retains each production IPC handler, performs successful writes normally, then delays the reply. Controlled rejections skip the write. Electron 32's private handler map is used only by this script, so replay on another Electron major may require updating the harness. No production bridge, storage format or main-process handler changes.

Contract sources checked: [Playwright ElectronApplication](https://playwright.dev/docs/api/class-electronapplication), [Electron ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main), and [Electron 32.3.3 IPC handler implementation](https://github.com/electron/electron/blob/v32.3.3/lib/browser/ipc-main-impl.ts).

This verifies callback ownership, not reordered disk commits, signed-in ACP, paper-grounded answers or recovery of an outgoing paper's failed write after navigation. Those behaviors are outside #92. Self-review against AGENTS.md and the issue found no remaining scope or renderer-isolation violations; independent parent review remains pending.

A separate isolated `npm run dev -- --noSandbox --remoteDebuggingPort 19392` launch was exercised through Playwright CDP. Visible Notes empty state, Create/Add Paper ingestion of the real Attention PDF, typing, Saved status and Clear all passed. This development smoke used a temporary data/config/cache root and shadowed adapters, then terminated its own process group. The production two-paper run above remains the controlled-failure and restart evidence.

Development process stderr included GPU initialization and DBus messages, plus `Failed to shutdown.` during harness teardown. Development-process shutdown was not certified. The separate production journey completed normal close/restart and retained clean renderer logs.
