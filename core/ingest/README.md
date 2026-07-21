# core/ingest

Pure Node/TS ingest pipeline: raw input → classified input → fetched PDF
bytes + metadata → markdown → (later cards) agent-extracted sections → store.

## PDF → markdown: `convert.ts`

**Chosen: [`unpdf`](https://www.npmjs.com/package/unpdf) (`^1.6.2`, verified on
npm 2026-07-21 — actively maintained, last publish 2026-04-29).**

`unpdf` is a thin wrapper around a serverless-friendly build of PDF.js
(`pdfjs-dist`, currently `6.1.200` upstream). It ships that build internally —
adding `unpdf` pulls in exactly one package, no transitive native/wasm deps —
so it installs and runs the same in the Electron main process, in tests, and
in CI without a native build step.

### Trade-off vs raw `pdf.js` (`pdfjs-dist`)

| | `unpdf` | raw `pdfjs-dist` |
|---|---|---|
| Setup | `extractTextItems(bytes)` — one call | manual worker config, `getDocument()`, per-page `getTextContent()`, canvas factory wiring for non-text ops |
| Node/Electron main-process fit | built for exactly this (serverless/Node), no DOM/worker assumptions | built for browser first; Node usage needs `legacy` build + polyfills |
| Text-with-font-size API | `extractTextItems` returns `{ str, fontSize, fontFamily, hasEOL, x, y, ... }` per run, ready to use | same data exists (`getTextContent()` items + `transform` matrix) but you derive `fontSize` yourself from the transform |
| Dependency footprint | 1 package (bundles its own PDF.js build) | `pdfjs-dist` directly — larger surface (canvas, image codecs, XFA) that ingest doesn't need |
| Cost paid | Less control over PDF.js version/build flavor; wrapper API is smaller than the full PDF.js surface (fine here — we only need text) | More boilerplate and Node-environment footguns (worker paths, `DOMMatrix` shims) for the same output |

Chosen `unpdf` because ingest only needs text-layer extraction (no
rendering, no image extraction, no forms) and the Electron main process is a
plain Node context — `unpdf`'s Node-first design removes a class of setup
bugs that raw `pdfjs-dist` carries into non-browser environments, for the
same underlying extraction quality (it *is* PDF.js under the hood).

### How `convert.ts` builds markdown

Text-layer extraction only — **no OCR**. `extractTextItems()` returns each
text run's string and font size (derived from PDF.js's text transform
matrix). `convertPdfToMarkdown`:

1. Flattens all runs across pages, drops empty ones.
2. Takes the most common font size on the document as "body text".
3. Any run at ≥1.8× body size → `# ` (H1); ≥1.15× → `## ` (H2); otherwise
   appended to the current paragraph.
4. Emits headings and paragraphs as markdown blocks, blank-line separated.

This is a **structural heuristic**, not a layout parser: it reads reasonably
for single/simple-column born-digital PDFs (verified on a real arXiv PDF,
`2401.12345` — title and a section heading correctly promoted, body prose
intact). Known rough edges: multi-column layouts can misclassify things like
a large drop-cap as its own heading; running headers/page numbers with a
distinct font size can appear as spurious headings. Acceptable for Phase-1
(paper.md is grepped by an agent, not typeset for humans); a later card can
add column-aware layout if this becomes a real wall.

Scanned/image-only PDFs have no text layer and throw a clear error — out of
scope for this card (no OCR dependency was added).

### Testing

`convert.test.ts` runs against a small hand-built, committed fixture
(`fixtures/sample.pdf`) — a real, valid single-page PDF with actual PDF text
objects (Helvetica, mixed font sizes for a title/section-headings/body
layout), not a mock. This proves real PDF.js text extraction + the
heading-inference heuristic end to end. A live real-arXiv-PDF check
(`2401.12345`) was run manually (not part of the automated suite, to keep
tests hermetic/offline) — see the "How `convert.ts` builds markdown" section
above for the result.
