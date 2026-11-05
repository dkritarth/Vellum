# Issue 118 verification

2026-11-05; branch `fix/118-html-ingest-error`, based on `origin/master`.

## Contract and research

[Crossref's full-text contract](https://www.crossref.org/documentation/retrieve-metadata/text-and-data-mining/)
distinguishes DOI landing pages from full-text URLs. Live `curl -L` for
`10.1371/journal.pone.0000308` followed doi.org, dx.plos.org and PLOS redirects
to an HTTP 200 `text/html;charset=UTF-8` article page (170,154 bytes).
Crossref's record listed only an `unspecified` similarity-checking link to
`http://dx.plos.org/10.1371/journal.pone.0000308`, no PDF link.

Reject explicit HTML/XHTML; cancel body before reading. Preserve missing/generic
MIME handling per implementation brief. No prefix sniffing or signature validation:
those would change compatibility beyond this slice. HTML mislabeled as PDF or
served without HTML MIME can still reach conversion. No publisher discovery.

## Automated evidence

- Red: DOI `fetchSource` regression resolved with HTML bytes instead of rejecting.
- Green: fetch and ingest tests, 34 passed.
- Full `npm test`: 41 files, 389 tests passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Mixed-case HTML/XHTML with parameters: rejected, zero body pulls, cancellation.
- PDF, missing MIME, generic MIME, local-file paths: preserved.
- Failed re-ingest: existing PDF/Markdown, serialized SQLite DB, paper and note
  unchanged; ACP session never created. Existing SSRF/limit tests still pass.

## Live Electron evidence

Built Electron 32.3.3 app, Node Playwright under Xvfb, isolated `VELLUM_DATA_DIR`
and Electron profile. Shared preview reported `available:false`. Native SQLite
rebuilt for Electron for live run, then restored for Node. No product test hooks.
Adapters excluded from PATH, so local import used existing extraction degradation;
this verifies import recovery, not signed-in ACP or AI metadata quality.

1. Click Create. Identifier input initially focused; empty Add Paper disabled.
2. Type real PLOS DOI, click Add Paper. Alert gives web-page explanation and
   direct-PDF/local-file remedy. Input and Cancel enabled afterward; library empty.
3. Replace identifier with `/tmp/vellum-117-real-paper.pdf`, click Add Paper.
   Real "Attention Is All You Need" PDF (2,215,244 bytes) imported; modal closed,
   reader opened. Local path entered through identifier control. Native file chooser
   not certified. Screenshot captured during reader loading, not final visual QA.
4. Save note through typed preload API. Repeat real DOI failure through controls.
   Paper record, PDF, Markdown and note unchanged. Cancel works.
5. Restart same isolated state. Paper and note unchanged.

Local artifacts (gitignored): `test-artifacts/issue-118/{doi-error,local-retry,restart}.png`
and `console.log`. One exploratory file-chooser attempt did not establish chooser
behavior; final successful run used typed local path. Live harness retained at
`/tmp/vellum118-live.mjs`; output `/tmp/vellum118-live.log`.

Console: expected main-process `vellum:ingest` errors carrying new remedy (twice).
Xvfb emitted `Exiting GPU process due to errors during initialization` and DBus
`org.freedesktop.DBus.Error.NoReply` diagnostics. No renderer console errors,
page errors, or PDF.js invalid-PDF warnings in captured log. Loading controls,
labels, focus and retry checked; no complete accessibility or reader-layout audit.

## Self-review

Standards: no findings. Narrow fetch-boundary check, typed existing interfaces,
unchanged SSRF, redirect, timeout and byte limits; no new dependencies.
Spec: selected explicit-MIME slice covered. Missing/misleading MIME sniffing,
publisher discovery, signed-in ACP and independent live review remain unverified
or outside selected scope. Only owned ingest files plus this verification note changed.
