# Reader paper ownership, issue #148

Verified 2026-11-06, Linux/Xvfb, Electron 32.3.3, Node 24.19.0.
Base PR [#99](https://github.com/dkritarth/Vellum/pull/99),
`fc1af65d16e89cbad6495cd8d8cba8fbc6dd013a`, includes alignment dependency
[#95](https://github.com/dkritarth/Vellum/pull/95). No #141 assets or lifecycle work.

## Red and green

Public Reader regression observed commit through sibling layout effect, before
passive effects. Base retained outgoing canvas, text `Introduction to Vellum`,
and one selection toolbar. Expected detached canvas, empty text, zero toolbars.
[Automated evidence](automated.txt) records failure before production edit.

Paper-specific React lifetime now owns canvas, text, overlays, selection, and
asynchronous completions. Reader retains zoom. Current page stays hidden with
loading status until canvas and text render finish. Reference indexing continues
independently. Deferred read/document/page/render tests verify hidden loading,
current Explain context, zoom/page, and first page visible before reference index
finishes. Five rapid A/B/A/B cases release stale read, document, page, canvas,
or text work after current B appears. Existing cancellation/alignment/highlight
and selection tests remain passing.

- Reader: 52 passing tests.
- Full suite: 41 files, 393 passing tests.
- Typecheck, build, `git diff --check`: pass.
- Own Node SQLite binding backed up before Electron rebuild, restored afterward.
  SHA-256 comparison passed; Node in-memory query returned `{ restored: 1 }`.
  No Node tests overlapped native rebuild.

## Live procedure and evidence

Real PDFs: [Attention Is All You Need](https://arxiv.org/pdf/1706.03762), 15 pages,
and [Less Than One-Shot Learning](https://arxiv.org/pdf/2009.08449), 8 pages.
Fresh temporary app data and Chromium profile for each run. Papers seeded into
isolated SQLite/filesystem; ingestion and metadata enrichment not exercised.
Paper Markdown is a placeholder; Reader uses original PDF bytes.

[Script](live.mjs) instruments only disposable compiled main. It holds **all**
real `read-paper-file` responses for a selected slug until explicit release,
including development StrictMode's duplicate request. Missing-file scenario
returns null instead of those bytes. No renderer/PDF.js replacements, ACP stub,
production IPC changes, or test hooks in shipped source.

Baseline production build: open B, open A, zoom to 125%, select A, hold B read,
click B tab. [Before](before-loading-leak.png) shows B selected with outgoing A
raster/text during loading. Fixed development and production Electron runs both
pass. Development launched with `npm run dev -- --rendererOnly --noSandbox`;
controlled Electron loads that server. Production loads built local HTML.
Actual controls and native double-click selection used throughout.

- [Empty state](empty.png): no paper open.
- [A selection](a-selection.png): selection actions available before switch.
- [Held B read](after-loading.png): loading visible, page layer hidden, text empty,
  native selection empty, zero highlight rectangles or selection actions.
- [Current B](b-current.png): B text and raster at retained 125% zoom.
- [B selection context](b-selection-context.png): selected B word in focused Ask
  composer, no A quote. Typed local draft; Tab reaches labeled Send button.
- [Late A completion](stale-a-completion.png): open held A, return to B, release A
  last. B remains. Four additional rapid A/B rounds finish on B.
- Navigate B page 2 and back; current page renders. Create yellow highlight via
  selection menu. [Highlight](b-highlight.png) belongs to B.
- [Missing PDF](missing-pdf.png): held A returns null; error replaces page.
  B recovers with stored highlight.
- [Restart](restart.png): close/relaunch same isolated store, reopen B through
  Library; B raster/text and persisted highlight restored. Zoom starts at 100%,
  matching existing restart behavior.

Renderer console has zero errors/warnings in [development](live-console.txt),
[production](built-console.txt), and [baseline](baseline-console.txt). Electron
stderr emits Xvfb GPU initialization and DBus `StartServiceByName` diagnostics.
These do not prevent rendering or assertions. Browser preview could not connect;
Playwright controlled actual isolated Electron instead.

Repeat after build and Electron SQLite rebuild:

```bash
xvfb-run -a node docs/verification/issue-148/live.mjs fixed
LIVE_RENDERER_URL=http://localhost:5173 xvfb-run -a node docs/verification/issue-148/live.mjs fixed
```

Script expects PDF paths listed near its top. Set `LIVE_EVIDENCE_DIR` to retain a
separate run. For baseline mode, build base Reader first and pass `baseline`.
Restore own Node SQLite binding before Node tests.

## Review and limits

Self-review against base: standards and issue #148 acceptance checked separately;
no blocking findings. Public Reader interface, renderer isolation, storage, and
ACP unchanged. Independent review still pending.

Live deterministic delays cover file reads; PDF.js stage delays and first-commit
observation covered by unit tests. Explain callback verified in unit tests;
live Add to chat verified without Send. Signed-in Codex/Claude ACP responses,
macOS/Windows, packaged installer, and PDFs needing #141 fonts/decoders untested.
No model requests, merge, issue closure, or phase unlock performed.
