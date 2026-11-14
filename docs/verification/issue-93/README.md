# Superseded PDF rendering, issue #93

Verified 2026-10-23 on Linux, Electron 32, PDF.js 6.1.200 and Node 24.
Dependency PR [#95](https://github.com/dkritarth/Vellum/pull/95), head
`0ffc345989507951457b800c54d67ebfa3742260`, merged normally into this branch.
Reader alignment implementation remains that dependency's work. Issue #93 only
changes Reader render lifecycle, Reader regressions and this evidence directory.

## Reproduction

Recovered interrupted Reader changes read-only from
`/home/dandapat/.t3/worktrees/Vellum2/t3-3cd8ff1d`; left old worktree unchanged.
First applied its deferred canvas test. Before production changes, test failed
with **2 overlapping tasks**, expected 0. Added deferred text test after canvas
fix; it failed with **0 cancellation calls**, expected 1. Final suite passes.
Recovered test's selection setup needed text-node boundaries matching Reader's
existing anchor contract. [Automated evidence](automated.txt) includes red logs.

Real paper downloaded from <https://arxiv.org/pdf/1706.03762>, Attention Is All
You Need, 15 pages. Before fixed production build, rapid real keyboard events on
visible zoom/page controls produced an unhandled PDF.js exception:
`Cannot use the same canvas during multiple render() operations.`
See [before console](before-console.txt) and [before screenshot](before.png).
Initial slower click-only attempt did not reproduce overlap; its 200% selection
drag exceeded available pane width. Reproduction then used supported 100–150%
zoom, CPU throttling at 6x, and 25 keyboard activations without render waits.

## Implementation and source contract

Effect cleanup cancels pending RenderTask and TextLayer work. Task references
clear in `finally` after settlement. Expected cancellation is suppressed only
when this effect requested cancellation at matching stage/class. Other failures
keep original console diagnostic; current failures show an alert and hide stale
page output. A new page or zoom clears error and retries normally.

Inspected installed first-party distribution, matching version pinned by lockfile:

- [PDF.js legacy build](https://github.com/mozilla/pdfjs-dist/blob/v6.1.200/legacy/build/pdf.mjs),
  lines 23042 and 23155–23166. RenderTask.cancel synchronously ends drawing,
  removes canvas ownership, then rejects with RenderingCancelledException.
  No asynchronous queue or settlement barrier required in this installed build.
- Same source, lines 21156–21160. TextLayer.cancel cancels reader and rejects
  render promise with AbortException, exact message `TextLayer task cancelled.`
- Same source, lines 23155–23166 and 23207–23211. Completed canvas tasks already
  release canvas. Cancelling completed task again can remove newer ownership;
  retain only pending tasks. Regression covers completed canvas plus pending text.

## Verification

`npm test`: **387 tests pass, 41 files**. Six new Reader lifecycle regressions
cover overlap/final selection, text navigation/unmount, completed canvas safety,
canvas/text failure recovery, and genuine failure settled during cleanup.
`npm run typecheck`, `npm run build`, `git diff --check`: pass.

```bash
xvfb-run -a node docs/verification/issue-93/live.mjs /tmp/vellum-93-attention.pdf /tmp/vellum-93-complete
xvfb-run -a node test/reader-alignment-live.mjs /tmp/vellum-93-attention.pdf /tmp/vellum-93-alignment
xvfb-run -a node test/reader-gate.mjs
```

All three gates pass. Actual Create clicks and typed local real-PDF path exercise
empty/loading/reader paths. Rapid changes finish page 1 at 125%, canvas and text
both **765 × 990**. Independent title coordinates, baseline and raster ink pass.
Pointer-selected title drives Add to chat with exact quote/page and composer
focus. Highlight persists after navigation and Electron restart; restart geometry
is **612 × 792**. [Measurements](measurements.json) record all five checks.

Injected one failure at Chromium's canvas API via DevTools, then used visible
zoom controls. [Error alert](render-error.png) appears, stale page hides, next zoom
recovers. [After console](after-console.txt) contains exactly that deliberately
injected error, no unexpected warnings/errors or unhandled rejections. Unmodified
alignment gate additionally verifies Explain, page 2 at 125%, restart and fully
clean console. Unmodified canvas gate passes five fixture opens and separate
live arXiv ingest/render with fully clean console.

Screenshots inspected: [final rapid render](rapid-final-125.png),
[highlight after navigation](highlight-after-navigation.png), [restart](restart.png).

All dependencies installed locally with `npm ci`. Electron rebuild touched only
this worktree's node_modules. Saved Electron binding under ignored
`out/resources/native/`, restored Node binding with `npm rebuild better-sqlite3`.
App data and Electron config/cache use isolated temporary roots. Rapid/alignment
gates disable adapter discovery; no signed-in response claimed.

Development launch also attempted. Plain `npm run dev` hits host SUID sandbox
configuration; `npm run dev -- --noSandbox` starts Electron, then bounded smoke
stops it after 15 seconds. Host stderr includes GPU/DBus initialization messages.
All clicked/typed journeys above use built Electron through documented Playwright
harness with `--no-sandbox`; renderer diagnostics remain as reported above.

## Review and limits

Local standards and spec review against dependency merge `61b89eb`: no findings.
No new renderer imports from Node/Electron, IPC, storage or alignment changes.
No nested reviewers, per parent assignment. Parent owns independent review.

Live rapid case covers pages 1/2 and 100–150%; final geometry at 125% and restart
at 100%. Zoom extremes, rotated/UserUnit documents, and signed-in ACP responses
not separately verified. Render failure exercised by explicit fault injection,
not malformed real-paper corruption. Issue remains in progress; no phase gates
or blocked issues changed. PR #95 dependency and parent review remain required.
