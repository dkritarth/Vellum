# Reader text alignment verification

Issue #86. Verified 2026-10-17 on Linux Electron 32 under xvfb with Node-only
Playwright tooling. Implementation commit `7cb3029`; final production build and
checks use `f009725`, which merges master through `e0e195d` (PRs #82, #85, #87).

## Reproduction and regression

The real source is `/tmp/vellum-live-evidence/attention.pdf`, arXiv 1706.03762,
Attention Is All You Need, 15 pages. The initial worktree was fast-forwarded from
`f37818d` to `36a2bdc` before implementation.

Added `test/reader-alignment-live.mjs` before changing Reader. Its initial run
failed with `Selectable glyphs must use PDF positions, not normal text flow`:
expected `absolute`, received `static`. The title had visible `rgb(234, 234, 234)`
text, inherited 16px font size and selection left/top `(0, 47)` relative to the
canvas. The PDF title starts at x=211.488 points with baseline y=162.043 from
the top. [Before](before.png) shows the pale duplicate over the real raster.

The browser gate checks computed transparency/position, page dimensions, font
scale, and DOM Range geometry against independent PDF text coordinates. It also
checks raster ink within that range. Width tolerance is two PDF points for
browser font metrics, plus a separate raster-width check. Hiding the duplicate
without fixing geometry fails this gate. It uses actual mouse drags to select
text and visible buttons to invoke both actions, without injecting selections or
calling private React functions.

## Official PDF.js contract

Inspected installed `pdfjs-dist` 6.1.200 first-party distribution:

- [`web/pdf_viewer.css`](https://github.com/mozilla/pdfjs-dist/blob/v6.1.200/web/pdf_viewer.css),
  lines 615–746: transparent, absolute, preformatted spans; font size and transform
  consume `--font-height`, `--scale-x`, `--rotate` and minimum-font variables.
  Generated `markedContent` wrappers require `display: contents`; keep that class
  literal inside the CSS module. Lines 6175–6182 define page rotation transforms;
  lines 6237–6241 define total scale and dimension rounding variables.
- [`legacy/build/pdf.mjs`](https://github.com/mozilla/pdfjs-dist/blob/v6.1.200/legacy/build/pdf.mjs),
  lines 7471–7492: `setLayerDimensions` overwrites pixel dimensions using
  `--total-scale-factor` and `--scale-round-x/y`. Lines 21079–21090 and
  21220–21298: TextLayer emits custom properties, percentage positions, font
  family and rotation, but relies on the stylesheet for rendering. PageViewport
  lines 6812–6817 include UserUnit in effective scale.

Reader now supplies `viewport.scale * viewport.userUnit` and scoped upstream
geometry/selection rules. It does not import the unrelated viewer stylesheet.
No app state, AskPanel, IPC, adapter or storage changes.

## Final checks

- `npm test`: 365 tests pass across 41 files, including 40 Reader tests. Reader
  regression coverage checks Add to chat on page 1 and Explain after page/zoom
  changes. Existing jsdom canvas-not-implemented stderr remains test noise.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
- `xvfb-run -a node test/reader-alignment-live.mjs /tmp/vellum-live-evidence/attention.pdf /tmp/vellum-reader86-final`:
  pass against the final merged production build.
- Existing `test/reader-gate.mjs`: pass, including five fixture opens, zoom
  controls, selectable text, and a separately downloaded real arXiv paper.
  Both renderer consoles have no errors or warnings.

Electron needs its better-sqlite3 ABI: `./node_modules/.bin/electron-rebuild -f -w better-sqlite3`.
Node unit tests need the Node ABI: `npm rebuild better-sqlite3`. The runs used
each matching binding sequentially; the worktree ends with the Node binding.
Full command logs are `/tmp/vellum-reader86-final-{tests,typecheck,build,alignment,canvas}.log`.

## Visible journey and evidence

Both app data and Electron config/cache use isolated temporary roots; no personal
browser profile or signed-in adapter is read. The alignment gate uses an empty
adapter PATH deliberately, making unavailable-agent behavior deterministic.

1. Click Library and verify empty state. Click Create, verify focused input,
   type the real PDF path, click Add Paper, and observe ingest/loading completion.
2. Verify page 1 at 100%. [Rendered page](page1-100.png) has no duplicate text.
   Drag across the title. [Selection](selection-page1.png) matches its glyphs.
3. Click Add to chat. Verify exact title quote, `(p. 1)`, and composer focus.
4. Click zoom + for 125%, verify title geometry again, then click next page.
   Drag across Introduction and click Explain. [Page 2 at 125%](explain-page2-125.png)
   shows the selected glyphs and exact `Explain this passage from page 2:` prompt
   with `> "Introduction"`. The expected missing-adapter error remains usable.
5. Restart with the same isolated data. Reopen the paper through Library; verify
   page 1 at 100% still aligns and the Explain prompt persists in Ask.

[Measurements](measurements.json) record all four geometry checks, including
restart. Final artifacts and additional screenshots remain under
`/tmp/vellum-reader86-final/`.

## Self-review and limits

Standards review against `origin/master...HEAD`: no findings. Renderer isolation,
existing public seams, scoped CSS, typed viewport values, and file ownership
remain intact. Spec review against #86: no findings within the tested journey.
Review performed locally; no review children, per the parent delegation limit.

Live verification covers 100% and 125% on real paper pages 1 and 2, and restart.
Other zoom extremes, non-default UserUnit documents and native rotated pages
were not separately exercised. Their styles follow the inspected upstream
contract. This reader gate verifies prompt text/page context and agent failure
recovery; it does not certify signed-in Codex or Claude answers. No ACP behavior
changed, so ACP smoke was not rerun. No push or PR was created; parent owns
integration and independent review.
