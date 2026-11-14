# Issue 125: arXiv XML text

Verified 2026-11-05. Base `757b5f8`, branch `fix/125-arxiv-xml-text`.

## Contract and automated evidence

[W3C XML 1.0 Char](https://www.w3.org/TR/REC-xml/#NT-Char) permits tab, LF,
CR, U+0020–D7FF, U+E000–FFFD, and U+10000–10FFFF. Discouraged characters
remain legal. [CharRef](https://www.w3.org/TR/REC-xml/#NT-CharRef) requires
decimal digits or lowercase `x` followed by hexadecimal digits, plus a semicolon.
[Predefined entities](https://www.w3.org/TR/REC-xml/#sec-predefined-ent) defines
`amp`, `lt`, `gt`, `apos`, and `quot`. Expanded references become character data.

`fetchSource` regressions use controlled HTTP `Response` bodies containing UTF-8
bytes. Before the fix, the named-entity regression failed with escaped title,
authors, abstract, and venue. After the named fix, five numeric cases failed.
Final focused run passed all 27 tests. Full suite passed 389 tests in 41 files.
`npm run typecheck`, `npm run build`, and `git diff --check` passed.

Cases cover all five entities, decimal and hex references, supplementary Unicode,
XML boundaries, legal discouraged characters, numeric whitespace, nested literals,
unknown names, malformed syntax, forbidden characters, and oversized references.
Decoding occurs once after field extraction, before existing whitespace collapse.
No parser dependency, DTD processing, external entity resolution, or Crossref change.

## Real network evidence

Actual `fetchSource({ kind: 'arxiv', slug: 'arxiv-2009.08449', value: '2009.08449' })`
over the public network returned:

```text
title: 'Less Than One'-Shot Learning: Learning N Classes From M<N Samples
abstract contains M<N: true
PDF: 3542378 bytes, %PDF- prefix
```

Separately downloaded Atom and PDF responses returned HTTP 200. Feed title,
abstract, and journal reference contain `&lt;` upstream.
PDF SHA-256: `c5df7480729819ce5911dc8f4e357f056a8ceb592581164ea7f382fd5b48bcf8`.

## Isolated Electron evidence

Built Electron app launched with Playwright under `xvfb-run`, unique
`VELLUM_DATA_DIR`, and unavailable adapter PATH. This deliberately exercises
fetch-metadata fallback without consuming an ACP session.

1. Opened Create, checked identifier autofocus and disabled empty submit, typed
   `2009.08449`, and clicked Add Paper. Opened Details. Title and venue showed
   decoded comparisons. `getPaper` returned decoded abstract.
2. Repeated with `2009.08449v1` and controlled XML fields. Verified title
   `Graphs & Attention`, author `A. O'Neil`, venue `Research & Science`, and
   abstract `x < y; 📚; &lt;; &#x110000;` through persisted `getPaper` metadata.
3. Confirmed saved PDF bytes exactly match the real download and converted
   markdown exceeds 10,000 characters. Closed Electron, relaunched with the same
   isolated data directory, compared all metadata, and reopened through Library.
4. Waited for PDF text-layer spans. Checked invalid identifier alert and Cancel
   recovery. Captured renderer and main console events had no warnings or errors
   except the expected `vellum:ingest` rejection for `not-a-paper`.

Electron HTTP responses replay downloaded real feed and PDF bytes in main-process
`fetch`. The second feed changes only the metadata fields above. This is injected
Electron evidence, separate from the direct network `fetchSource` run.

[Restart screenshot](issue-125/restart.png) shows controlled metadata beside the
real PDF. Reader text-layer display overlaps PDF content, tracked by
[#86](https://github.com/dkritarth/Vellum/issues/86); unrelated to decoding.

## Review and limits

Inline self-review against repository standards and issue scope found no defects.
Four arXiv text fields change. Crossref, request limits, redirects, and targets stay
unchanged. Existing persisted records require re-ingestion to acquire decoded text.
Signed-in ACP and independent maintainer review remain unverified. No phase unlock.
