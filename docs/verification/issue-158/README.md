# Reader search validity, issue #158

Base: `dd161d346077c450c87e305821d33af53deefecf`, PR
[#157](https://github.com/dkritarth/Vellum/pull/157), branch
`fix/154-reader-task-cleanup`. Full dependency stack:
[#153](https://github.com/dkritarth/Vellum/pull/153),
[#99](https://github.com/dkritarth/Vellum/pull/99),
[#95](https://github.com/dkritarth/Vellum/pull/95).

Input edits invalidate submitted search ownership, clear matches/error, and allow
another explicit submission immediately. Success, failure, and finally all check
request ownership and existing paper disposal. Obsolete extraction may finish,
but cannot publish matches, navigate, report error, or end newer loading.

Empty/unsubmitted input has no result count. Pending submission announces
`Searching…`. Completed empty result has `0 / 0`. Current failure renders a
separate `role="alert"` with error detail and retry instruction. Search button or
Enter retries. No auto-search, extraction rewrite, or toolbar redesign.

## Automated evidence

Original public-component proof confirmed at
`/tmp/vellum-reader-search-repro/repro.test.tsx` and `result.log`. Original proof
has two failing cases and unhandled `Search text unavailable` rejection.

[Red](red.txt): four new Reader regressions fail against exact base with one
unhandled search rejection. [First clear regression](red-clear.txt) captured
before production edit; [first green](green-clear.txt) passes. [Final focused
run](focused.txt): 65 Reader tests pass. Tests exercise current rejection/retry,
late clear success/page stability, stale success/failure while newer request is
pending, and removal of completed navigation on edit. Existing tests retain
paper-switch/unmount and task disposal coverage.

[Full suite](tests.txt): 41 files, 406 tests pass. [Typecheck](typecheck.txt),
[build](build.txt), and `git diff --check` pass. Existing jsdom canvas diagnostics
remain in suite output; jsdom does not provide real rendering.

Own checkout's Node SQLite binary backed up before Electron rebuild. No Node
suite overlapped rebuild/live run. Restored binary compares byte-for-byte with
backup; [before](sqlite-before.txt) and [after](sqlite-restored.txt) SHA-256 match.
Node in-memory `select 1` succeeds after restore; full Node suite rerun afterward.

## Live Electron evidence

Linux/Xvfb, Electron 32.3.3, PDF.js 6.1.200, Node 24.19.0. Actual Library/tab/page,
search, Notes, and highlight controls exercised through Playwright clicks,
input fill, double-click selection, Tab, and Enter. Fresh temporary app data and
Electron profile per run. No personal configuration or credentials inspected.

Real public PDFs: [Attention Is All You Need](https://arxiv.org/pdf/1706.03762)
and [Less Than One-Shot Learning](https://arxiv.org/pdf/2009.08449). Paper records
and original PDF files seeded into isolated state. Markdown placeholder only.
Ingestion and signed-in ACP not exercised.

Both [built results](live-results.json) and [development results](dev/live-results.json)
pass success/Next match, no matches, unsubmitted state, controlled pending clear,
late success/page stability, pending edit followed by new submission, old
success/failure preserving new loading, current failure/keyboard retry, pending
search failure after paper switch, focus/Tab/Enter, and process restart with saved
note and highlight. Built [run output](live.txt), development [output](dev-live.txt).

Screenshots: [success](success.png), [no matches](no-matches.png),
[pending](pending.png), [cleared stale success](cleared-stale.png),
[current error](search-error.png), [retry](retry.png), [saved research](saved-research.png),
[restart](restart.png), [development error](dev/search-error.png),
[development restart](dev/restart.png). Error remains readable below toolbar;
paper, page controls, search, and Notes remain usable.

Built [renderer console](console.txt) has one exact upstream warning:
`Warning: getTextContent - ignoring errors during "GetTextContent: page 3" task: "Error: Worker task was terminated".`
Development [renderer console](dev/console.txt) has no warnings. Both have zero
renderer errors, pageerrors, or unhandled search rejections. Harness only allows
that exact upstream termination-warning shape. [Built main stderr](main-stderr.txt)
and [development main stderr](dev/main-stderr.txt) retain Xvfb GPU initialization
and unavailable D-Bus diagnostics. No claim of globally clean Electron stderr.

## Reproduce and injection limits

1. Obtain the two public PDFs at `/tmp/vellum-121-attention.pdf` and `/tmp/vellum-125-real-paper.pdf`.
2. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.
3. Back up `node_modules/better-sqlite3/build/Release/better_sqlite3.node` outside the checkout.
4. Run `npx electron-rebuild --force --only better-sqlite3` after all Node tests finish.
5. Run `xvfb-run -a node docs/verification/issue-158/live.mjs`.
6. For development, launch `npm run dev -- --rendererOnly --noSandbox` under Xvfb with fresh `VELLUM_DATA_DIR` and `ELECTRON_CLI_ARGS='["--user-data-dir=/tmp/vellum158-dev-profile"]'`.
7. Run `LIVE_RENDERER_URL=http://localhost:5173 LIVE_EVIDENCE_DIR=docs/verification/issue-158/dev xvfb-run -a node docs/verification/issue-158/live.mjs`.
8. Stop Electron/development processes. Restore SQLite backup and compare bytes before any Node tests.

[Harness](live.mjs) seeds disposable compiled main output. Built renderer or
intercepted development Reader module wraps only the search call's completion.
Every search first performs actual PDF.js extraction, then instrumentation either
holds its result or throws a named injected error. Queued success/failure releases
force adversarial ordering. No replacement document, worker, text, or render
result. Compiled renderer restored and temporary main removed in finally.

These are deterministic injected search-completion failures, not naturally failing
PDF transport or ordinary overlapping disabled-button clicks. Real extraction
failures and task disposal have component regression coverage. No screen-reader
speech, heap/GC, large-corpus performance, packaged installer, ACP, or responsive
toolbar claim. Narrow toolbar work remains separate.

## Self-review

Standards: no findings. Scope limited to Reader search, narrow error CSS,
component regressions, and verification artifacts. Renderer isolation and existing
PDF loading-task disposal unchanged. No persistence, backend, build, or auth edits.

Spec: no findings. All #158 criteria exercised as above; injected timing/failure
limits disclosed. Inline standards/spec review only, per no-subagents instruction.
Independent maintainer review and live repetition remain pending. Draft only;
no merge, phase unlock, or watch.
