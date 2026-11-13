# Issue 131 verification

Verified 2026-11-05 on isolated `fix/131-legacy-arxiv`, based on master
`757b5f886bf79db9761ed59889ad89fec4a69aab`.

## Contract and sources

[Issue 131](https://github.com/dkritarth/Vellum/issues/131) limits production
changes to classification. [Official identifiers](https://info.arxiv.org/help/arxiv_identifier.html#old)
define archive, optional two-letter subject class, slash, seven digits, and version.
[API id_list](https://info.arxiv.org/help/api/user-manual.html#3111-search_query-and-id_list-logic)
retrieves article metadata. Subject class removed before lookup. Canonical value
retains slash; slug replaces structural slash with hyphen. Modern handling unchanged.

## Automated evidence

- Red: new alias regression failed with `unrecognized input: hep-th/9905111`;
  existing 15 classifier tests passed before production edit.
- Green: `npm test -- core/ingest/classify.test.ts core/ingest/index.test.ts`,
  52 tests passed. Includes alias/version normalization, modern slugs, malformed
  inputs, existing slug validation, and generic PDF source handling.
- Ingest regression stubs external HTTP and ACP only. Real conversion, filesystem,
  SQLite, and public repositories verify canonical re-ingest preserves note,
  highlight, chat/message, and collection after DB reopen. Seeded historical generic
  record, note, and PDF bytes remain unchanged.
- `npm test`: 410 tests in 41 files passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Original Node SQLite binding restored byte-for-byte after Electron verification;
  Node SQLite query passed after restoration.

## Live Electron evidence

Playwright launched built Electron 32.3.3 under Xvfb with unique `VELLUM_DATA_DIR`
and `--user-data-dir`. Actual visible controls clicked and typed; no HTTP response
or transport injection. ACP disabled by app-only `PATH=/usr/bin:/bin`; personal auth
untouched. This verifies metadata fallback and persistence, not signed-in ACP.

1. Empty library; identifier input focused; empty Add Paper disabled. Traversal
   input displayed error; input re-enabled. Loading message appeared on ingest.
2. Entered `hep-th/9905111` through Create. Real arXiv returned **Large N Field
   Theories, String Theory and Gravity**, five authors, 1999, journal reference.
   Saved `arxiv-hep-th-9905111/paper.pdf`, 1,871,615 bytes with `%PDF-` header.
3. Opened library card. Page 1 of 261 rendered at 612×792 with 72 text spans.
   [Reader and metadata screenshot](legacy-reader.png).
4. Typed note, waited for Saved. Re-ingested equivalent
   `https://arxiv.org/pdf/hep-th/9905111.pdf`. One record; same slug and note.
5. Closed/relaunched Electron with same isolated state. Reopened paper, waited
   for loading to finish and canvas dimensions, verified note in editor.
   [Restart and note screenshot](restart-note.png).
6. Entered `math.AG/0309136` through Create. Real API returned **Regular points in
   affine Springer fibers**, three authors, 2003, canonical `math/0309136`.

## Limits and self-review

No renderer exceptions. Console is not clean: PDF.js reports missing wasm/font
resources and JS CCITT fallback, tracked in [issue 132](https://github.com/dkritarth/Vellum/issues/132).
Headless Electron reports GPU/DBus warnings.
Screenshots retain existing misaligned visible text overlay, tracked by [issue 86](https://github.com/dkritarth/Vellum/issues/86) / PR 95.
Only first hep-th page inspected; full-document rendering/selection not verified.
ACP extraction, summary, and chat were disabled and remain unverified here.

Historical generic imports are untouched. Importing a newly recognized arXiv form
may create a separate canonical record; no rename, overwrite, or reconciliation.
Versions retain distinct slugs. No fetch/security/schema/ACP production changes.

Inline self-review against `origin/master`: standards and issue scope inspected,
no blocking findings. No agents spawned. Draft remains for independent review;
no merge or phase unlock.
