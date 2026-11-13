# Notes initial-read recovery

Issue #163. Stack base #98 at `052e1482627b5a85dcb27122bd297d2071689192`. Tested 2026-11-06, Node 24.19.0, Electron 32.3.3, Linux/xvfb.

## Behavior and red-green proof

Initial loading and failed reads now disable Note and Clear. Loading has `role="status"`; failure has useful `role="alert"` text and keyboard-reachable Retry. Only a successful current read enables editing. A successful missing-note read enables a truly empty editor. Retry restores saved text without writing it.

This intentionally replaces #98's earlier typing-before-initial-read policy. Those three tests became guarded-load tests. Existing loaded-note edit, debounce, flush, stale save/delete and same-paper revisit regressions remain. No backend, preload, schema, authentication or generic state framework changes.

[Original injected proof](original-repro.txt) records simulated storage overwritten after a failed read. [Local red test](red.txt) reproduced `replacement for unread note` replacing `Existing research note with important evidence` before production edits. [Green](green.txt): 28 NotesPanel tests pass. [Full suite](full-tests.txt): 396 tests across 41 files pass, including a repeat after restoring the host native binary. Typecheck, production build and `git diff --check` pass. Existing Reader jsdom canvas-not-implemented stderr remains.

## Live verification

[Production harness](live.mjs) uses existing isolated launch helper. Real PDFs ingested through visible Create / Add Paper, actual PDF canvas/text checked. No personal database, config, browser profile, credentials or signed-in ACP used. Both adapters shadowed with local exit-127 executables. Local-file title fallback expected.

[Results](live-results.json) and [run output](live-run.txt) cover:

- Delayed initial load, keyboard attempts blocked, Clear disabled.
- Injected initial failure and repeated retry failure. Tab traversal reaches Retry; Enter invokes it. Successful retry displays original, with zero save/delete calls.
- Switch during pending retry success and Notes unmount during pending retry failure. Late replies cannot change current paper; no write/delete occurs.
- Full process restart before intentional edits. Original A, unrelated B note, and unrelated chat history retained.
- Loaded keyboard edit, focus, debounce save, quick Details unmount flush, normal Clear, successful missing-note read, and subsequent save.
- Second restart retains final intentional A note, unchanged B note, unchanged unrelated history message, and byte-identical ingested PDFs.
- Three launches, zero captured renderer console errors, warnings or page errors.

Screenshots inspected: [loading](loading.png), [error](load-error.png), [recovered original](recovered-original.png), [restart original](restart-original.png), [true empty note](missing-note.png). Existing PDF overlay defect #86 remains visible; this stack deliberately does not include Reader changes.

Separate [development smoke](dev-smoke.mjs), launched with `npm run dev -- --noSandbox --remoteDebuggingPort 19363`, passed visible ingestion of Attention, empty Notes, typing/save, focus, and Clear. [Output](dev-run.txt), [renderer console](dev-console.txt), [process output](dev-process.txt). Renderer had no errors/warnings/page errors. Process output includes GPU initialization failure and DBus `NoReply`; those environment messages are not renderer errors. Development teardown uses process-group SIGTERM; graceful development shutdown not certified. Production normal close/restart passed.

Final production isolated data retained at `/data/dandapat/.tmp/vellum-163-pEmYWX`; development data at `/data/dandapat/.tmp/vellum-163-dev-w0gXdY`. Temporary paths are local inspection aids, not durable remote evidence. Committed artifacts above are durable.

## Fault injection and limits

Failure is deterministic verification-only IPC injection, not a naturally reproduced transient SQLite fault. The harness retains production handlers through Electron 32's private `_invokeHandlers` map, wraps only note channels, holds selected get replies, and rejects selected reads with `issue-163 injected read failure` without running the read handler. Successful held reads execute the production handler and delay its reply. Every save/delete still uses the production handler. Calls are recorded to prove zero mutations before successful recovery. This harness may require changes for another Electron major.

Unrelated history was seeded directly into the isolated SQLite DB in Electron, without invoking ACP; subsequent preservation checked through the bridge and final message-row inspection. No claim of signed-in ACP validation, measured natural-failure incidence, or real storage corruption. Save/delete failure feedback and reordered disk commits remain outside this issue. New loading policy deliberately disallows typing until initial read succeeds.

Native SQLite host binary backed up before Electron rebuild, then restored with `cmp` and SHA-256 confirmation. Host binary SHA-256 `45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`. No Node store tests overlapped rebuild or Electron runs. Full suite repeated after restoration.

## Reproduction

```bash
npm ci
npm test -- src/app/NotesPanel.test.tsx
npm test
npm run typecheck
npm run build
# Save the host native module outside this checkout before rebuilding.
cp node_modules/better-sqlite3/build/Release/better_sqlite3.node /tmp/vellum-163-host.node
npx electron-builder install-app-deps
xvfb-run -a node docs/verification/issue-163/live.mjs /path/attention.pdf /path/bert.pdf
xvfb-run -a node docs/verification/issue-163/dev-smoke.mjs /path/attention.pdf
# Stop Electron before restoring. Do not run Node tests during this interval.
cp /tmp/vellum-163-host.node node_modules/better-sqlite3/build/Release/better_sqlite3.node
cmp /tmp/vellum-163-host.node node_modules/better-sqlite3/build/Release/better_sqlite3.node
npm test
git diff --check
```

Paper sources downloaded for this run:

- Attention Is All You Need, <https://arxiv.org/pdf/1706.03762>, SHA-256 `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
- BERT, <https://arxiv.org/pdf/1810.04805>, SHA-256 `5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e`.

Harness contract references: [Playwright ElectronApplication](https://playwright.dev/docs/api/class-electronapplication), [Electron ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main), [Electron 32 handler map](https://github.com/electron/electron/blob/v32.3.3/lib/browser/ipc-main-impl.ts). Existing #98 harness supplied this verification pattern; no new product Electron contract.

## Self-review

Inline review only, per explicit no-subagents instruction. Compared against pinned #98 head and #163 contract.

Standards: no findings. Renderer still uses typed bridge only; no new dependency or IPC method. Narrow local state and CSS reuse current design tokens. Request cleanup retires obsolete reads; existing generation/revision guards remain on loaded mutations.

Specification: no findings. Guarded loading/error, repeat Retry, true missing-note recovery, stale retry retirement, preserved loaded edits and full checks/live paths covered. Independent parent review and CI remain pending. Draft only; no merge, watch, label changes or phase unlock.
