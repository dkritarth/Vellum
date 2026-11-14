# Reader document disposal, issue #154

Verified 2026-11-06 on Linux/Xvfb, Electron 32.3.3, Node 24.19.0.
Base [#153](https://github.com/dkritarth/Vellum/pull/153), branch
`fix/148-reader-ownership-09761`, verified head
`060ae2d821e003c714a7b44700ffe3482c8e9a5b`. Full dependency stack:
[#95](https://github.com/dkritarth/Vellum/pull/95),
[#99](https://github.com/dkritarth/Vellum/pull/99), #153, this change.

## Contract and implementation

Official [PDFDocumentLoadingTask.destroy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html#destroy)
aborts network requests and destroys the worker. Installed PDF.js 6.1.200
`types/src/display/api.d.ts:827` documents `Promise<void>` completion.
`legacy/build/pdf.mjs:21593` waits for setup and transport destruction, then
calls the owned worker's destroy. `PDFWorker.destroy` at line 22392 calls
native Worker.terminate. A rejected destroy can leave cleanup incomplete;
Reader consumes that rejection but does not claim successful termination.

Reader retains each loading task in its load effect and calls destroy once on
paper replacement/unmount. It does not separately destroy the document proxy.
Cancellation before read completion creates no task. Disposed-paper load,
outline/index, render, and search completions cannot change the current paper or
report misleading errors. Current load/render errors retain existing behavior.
Same-document page/zoom cancellation remains covered by #99 tests.

## Red and green

[Automated evidence](automated.txt) includes red before production edit:
52 existing tests passed, new ready-document replacement/unmount regression
failed because destroy had zero calls. A later active-search regression exposed
an unhandled rejection when document destruction interrupted search; red captured
before handling disposed-paper search rejection.

- 61 Reader tests pass, including nine new cases for ready/pending/failed loads,
  rapid A/B/A/B, abandoned reads, rejected destruction, outline/text failure,
  and search interruption. External PDF.js test adapters now include destroy;
  production does not duck-type away that required contract.
- Full suite: 41 files, 402 tests pass. Typecheck, build, diff check pass.
- Own Node SQLite binding backed up, rebuilt for Electron after Node checks,
  then restored byte-for-byte. SHA-256 and Node SQLite query pass. No Node suite
  overlapped the Electron rebuild.

## Live verification

[Script](live.mjs) uses fresh temporary app state/profile, original public
[Attention Is All You Need](https://arxiv.org/pdf/1706.03762) and
[Less Than One-Shot Learning](https://arxiv.org/pdf/2009.08449) PDFs.
Library records/files are seeded; Markdown is a placeholder. Ingestion and ACP
are not exercised. Playwright controls actual Electron Library/tab/page/zoom
buttons, native double-click selection, Add to chat, typed draft and Tab focus.

Both built local HTML and development renderer launched through `npm run dev`
pass delayed read, hidden loading, current B rendering/selection, retained 125%
zoom, late A completion, repeated switches, page navigation, highlight creation,
missing-file recovery, Library unmount and process restart with stored highlight.
Ask composer receives B quote, gets focus, and Tab reaches labeled Send. No Send
or signed-in ACP call. Screenshots: [loading](after-loading.png),
[B context](b-selection-context.png), [restart](restart.png).

Disposable compiled main holds real file-read responses and returns null for
missing-file scenario. Disposable built renderer, or intercepted development
PDF.js module response, wraps the actual loading task destroy. Native Worker
subclass counts construction/termination and can queue message delivery to force
pending worker setup and active-search replacement. Real PDF.js operations run;
no fake document, render, text layer, or worker results. Counters retain task IDs,
not document/worker references. Instrumentation is not shipped. Compiled renderer
is restored in finally. Worker-delay testing is deterministic instrumentation,
not a natural network timing claim.

Both [production](built-runtime.jsonl) and [development](dev-runtime.jsonl):
17 tasks created, 16 destroyed with B current; all 17 destroyed once and all 17
native workers terminated after Library unmount. Pending worker/search switches
also settle each outgoing destroy. Restart creates one current B task/worker.
These counts prove observed disposal, not heap size or GC behavior.

[Production](built-console.txt) and [development](dev-console.txt) each contain
four exact upstream PDF.js warnings: `getTextContent - ignoring errors during
"GetTextContent: page N" task: "Error: Worker task was terminated".` Script
allows only that exact warning shape. Zero unexpected warnings, renderer errors,
page exceptions or unhandled rejections. Upstream warnings are not suppressed
in production code. Electron stderr contains Xvfb GPU/DBus diagnostics.

Repeat after build and Electron SQLite rebuild:

```bash
xvfb-run -a node docs/verification/issue-154/live.mjs
LIVE_RENDERER_URL=http://localhost:5173 LIVE_EVIDENCE_DIR=/tmp/vellum154-dev-evidence xvfb-run -a node docs/verification/issue-154/live.mjs
```

Script lists expected PDF paths; restore own Node binding before Node tests.

## Review and limits

Inline self-review against base checked standards and #154 contract separately.
No blocking findings. Search interruption found and fixed during review. No new
seam, model, IPC, engine, assets, build configuration, schema or ACP changes.
Independent review pending; issue remains in progress, draft only.

Unit adapters force rejected destroy and load/index/render failures. Live run
uses real workers with delayed delivery and injected missing-file response;
corrupt/encrypted PDFs and naturally rejected worker destruction are not live
verified. #141 font/decoder resources remain absent in this base and unchanged.
No claim for PDFs requiring those resources, measured heap/GC growth, other OSes,
packaged installers or signed-in Codex/Claude support. No merge or phase unlock.
