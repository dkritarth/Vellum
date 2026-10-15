# Current-truth audit of the Vellum core journey

Audit date: 2026-10-15. Commit under test: `bc21166` (master, after #67 and #68).

This supersedes the 2026-08-22 audit in `docs/verification/electron-core-journey-2026-08-22.md`.
That audit was accurate for commit `a21d596` but is now stale: three of its
blockers were fixed, the Codex path now works, and one **new critical defect
that it could not have found** is now documented here.

Scope: the core value proposition — ingest → library → reader → Ask →
grounded answer → durable state — exercised in the real built Electron app
against a real born-digital paper, with the real signed-in Codex ACP adapter.

Method and honest limits are recorded in
[`docs/verification/2026-10-15-core-journey-method.md`](./2026-10-15-core-journey-method.md).

## Headline

**The product is not in working condition.** The AI half of the core loop —
ingest a real paper, ask a question, get an answer genuinely grounded in that
paper's own text — works, and works well. The reading half does not: **the
reader renders no PDF at all.**

## Result matrix

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 1 | App boots, preload bridge alive | **Pass** | `bridge: pong` in footer |
| 2 | `npm test` | **Pass** | 336 tests, 40 files |
| 3 | `npm run typecheck` / `npm run build` | **Pass** | clean |
| 4 | Codex signed-in ACP smoke | **Pass** | `VERIFIED — stopReason: end_turn`, 18,203 tokens |
| 5 | Ingest real arXiv `1706.03762` | **Pass** | slug `arxiv-1706.03762`, 2.2 MB pdf, 40 KB `paper.md`, 9 sections, full metadata |
| 6 | Paper appears in Library UI | **Pass** | `01-library.png` |
| 7 | **Reader renders the PDF** | **FAIL** | 0/8 renders over repeated opens; "Could not open this PDF.", 0 `<canvas>` |
| 8 | Ask a paper-specific question through Codex | **Pass** | streamed 141 ACP events, ended `done` |
| 9 | **Answer is grounded in the real paper** | **Pass** | quoted the paper's exact sentences, cited `paper.md:33` |
| 10 | Paper + chat survive app restart | **Pass** | `04-after-restart.png`; session id and 2 messages restored |
| 11 | Renderer console clean | **Pass** | 0 errors, 0 warnings |

Steps 7 is the blocker. Everything else in the core loop is demonstrated.

## Finding 1 — CRITICAL: the reader renders no PDF for any paper

**Symptom.** Opening any ingested paper shows the literal text
`Could not open this PDF.` in the reader pane. No `<canvas>` element is ever
created. The paper tab itself opens correctly, the right-hand Ask/Notes/Details
panels populate, and the Library is unaffected.

**Reproduce.**

```bash
npm run build
# launch the built app, ingest 1706.03762, click the Library card
document.querySelectorAll('canvas').length  // => 0
```

**How reliably it fails.** Opening and closing the same ingested paper eight
times in one app session:

```
open #1..#8: canvases=0 sized=0 Could not open this PDF. => FAIL   (all eight)
RENDER RATE: 0/8
```

It is not intermittent. One earlier single observation of a single `<canvas>`
is explained by a canvas being created and then torn down, not by a successful
render.

**What was ruled out.** These were each eliminated with a direct experiment,
not by inspection:

- *Not an IPC truncation.* `readPaperFile(slug)` returns a byte-exact
  `ArrayBuffer`: 2,215,244 bytes, identical to the on-disk file, not detached,
  correct `%PDF-1.5` magic, valid `%%EOF` trailer.
- *Not a corrupt PDF.* It is the genuine arXiv PDF, and it extracts to 40 KB of
  clean text.
- *Not a `file://` worker restriction.* The renderer origin is `file://`, but a
  module Worker is constructible there.
- *Not an `unpdf` conflict.* `unpdf` is only used in the main process.
- *Not a missing asset.* `pdf.worker-*.mjs` (2.2 MB) is emitted into
  `out/renderer/assets/`.
- *Not caused by the two PRs merged during this audit* (#67, #68) —
  reproduced on `bc21166`, which contains both.

**What is actually observed.** Instrumenting `src/app/Reader.tsx`'s error path
produced exactly one error:

```
UnknownErrorException: hashOriginal.toHex is not a function
```

thrown from the **main** renderer bundle, not from the worker. The installed
`pdfjs-dist` is 6.1.200 and is the only copy:

- `build/pdf.worker.mjs` contains `toHex` — 5 occurrences.
- `build/pdf.mjs`, the entry build the renderer actually imports, contains
  **zero** occurrences of `toHex`.

**Important caveat on root cause.** It is tempting to conclude "the pdfjs
main and worker builds disagree, therefore that is the bug". That conclusion is
**not yet established**, and this audit deliberately does not assert it. pdf.js
constructs an exception object when `getDocument()` rejects; if that
construction is itself what throws, then `hashOriginal.toHex is not a function`
is a *secondary* failure that masks the real reason `getDocument()` rejected.
The underlying error is currently unknown and must be recovered before the fix
can be trusted.

**Why it stayed invisible.** `src/app/Reader.tsx` wraps the load in a bare
`catch {}` that swallows the exception and substitutes a generic message. The
real error never reaches the console — so even the one error that does exist is
invisible to a user or a log reader. Compounding this, *no existing live gate
ever opens a paper in the reader* — all six drive `window.vellum.*` over IPC and
assert on returned data, never on rendered output. A completely non-functional
reader passes every gate in the repository. This is the single most important
lesson of the audit: **the suite proved code paths, never the user-visible
thing.**

## Finding 2 — CRITICAL: a 60-second hard cap kills legitimate Codex answers

`core/acp/stdio-client.ts:280` hardcodes `DEFAULT_TURN_TIMEOUT_MS = 60_000`,
applied to a whole agent turn. That is a **total-duration** cap, not an
idle/stall cap, and it is far too short for this product's real workload: spawn
an adapter, create a session, read files off disk, reason about a research
paper, stream a multi-paragraph answer.

Observed live on the *second* run of the same question that had succeeded on the
first. The turn streamed 63 events of correct partial output —

> "I'll read the paper's model architecture section and quote its layer-count
> sentence exactly."

— and was then terminated:

```
FAIL  Ask turn completed with done — final=error
  ERROR: ACP turn timed out after 60000ms
```

The user sees a half-finished answer die mid-sentence. The fact that the
identical question succeeded once and timed out once also shows this is a
**race against wall-clock time**, not a deterministic property of the question.
A research assistant that abandons long answers is not usable, so this is a
core-loop defect rather than a tuning nit.

The correct fix is semantic, not numeric: reset an **idle** timer on every ACP
update so a productive turn is never killed regardless of total duration, while
keeping a genuinely stalled turn bounded and keeping process-kill guarantees so
no orphan adapter survives.

## Finding 3 — Pass, and better than expected: Codex Ask is genuinely grounded

This is the part of the product that works, and it works correctly.

A real signed-in Codex ACP session was asked a question answerable only from
this specific paper — the proposed architecture name and the base encoder /
decoder depth, with a request to quote the exact sentence. Codex streamed 141
ACP update events and ended with `done`. The answer:

> The paper proposes the **Transformer** architecture. Its base configuration
> has **6 encoder layers and 6 decoder layers**. Section 3.1, "Encoder and
> Decoder Stacks," states:
>
> > "The encoder is composed of a stack of N = 6 identical layers."
> >
> > "The decoder is also composed of a stack of N = 6 identical layers."
>
> `[Source: paper.md](.../data/papers/arxiv-1706.03762/paper.md:33)`

That is correct for arXiv 1706.03762, it matches `paper.md`, it carries a
verifiable file-and-line citation, and it is not answerable from generic prior
knowledge without the file. Grounding via agent-native file reads works as
designed; no custom RAG is needed.

## Finding 4 — Fixed during this audit: arXiv papers could never be purged

`purgePaper()` validated slugs with `/^[a-z0-9-]+$/i`, which rejects dots, while
every arXiv slug is `arxiv-<id>` containing a dot. The main process used a
*different*, dot-permitting pattern. The two regexes had drifted, so permanent
purge threw `Invalid slug format: arxiv-1706.03762` for exactly the papers the
product exists to hold.

Reproduced live on master before the fix, fixed in
[#67](https://github.com/dkritarth/Vellum/pull/67) / issue #64, with the
path-traversal guard preserved and explicitly regression-tested.

## Finding 5 — Fixed during this audit: live gates wrote to the real `data/`

Every gate opened the developer's real `data/app.db` and wrote real PDFs into
the real `data/papers/`. A gate run could destroy a real library, and because
the gates re-ingest fixed fixtures each run, the risk was routine.

Fixed in [#68](https://github.com/dkritarth/Vellum/pull/68) / issue #63, which
introduces a `VELLUM_DATA_DIR` override and per-gate failure artifacts.
Independently re-verified with a planted sentinel file: byte-identical
afterwards, no stray files.

## Finding 6 — Open: `better-sqlite3` cannot load from a foreign working directory

Launching Electron with any cwd other than the repository root fails:

```
Error: Module did not self-register:
  '<repo>/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
```

Bisected to be purely cwd-dependent (not env-dependent) across four launch
variants. Cause: better-sqlite3 v11 loads its addon through the `bindings`
package, whose module-root detection falls back to `process.cwd()`, so the
addon gets `dlopen`ed under a differently-derived key.

Impact: Vellum cannot be launched from a `.desktop` entry, a service wrapper,
or any directory but the repo root — and it blocks the temp-cwd isolation that
issue #27 needs. Note the isolation added in #68 deliberately routes around
this via an env var, so it does not mask the defect. Tracked for follow-up.

## Finding 7 — Open: PDF-by-URL ingest is an SSRF / hang / OOM vector

`fetchPdfFromUrl()` fetches a user-supplied URL with no scheme restriction, no
destination filtering, no timeout and no size cap, then buffers the whole body.
Loopback, private ranges and cloud metadata endpoints are reachable; a hanging
server blocks ingest forever. Fix in progress in issue #65.

## Finding 8 — Two of six live gates fail

`test:gate:collections` and `test:gate:trash` both fail on master (exit 1).
Both failures are in test expectations, not product behavior: the Library card
is a `div[role="listitem"]`, but the gates query `button[role="listitem"]`, and
the two fixture PDFs are byte-identical duplicates that ingest to the same
title, so the trash gate cannot tell its two papers apart. Fix in progress.

## Why the repository's green build was misleading

- Unit tests mocked `pdfjs-dist` wholesale, so no test ever parsed a real PDF.
- Live gates exercised IPC return values, never rendered UI output.
- The reader's bare `catch {}` converted a hard parse failure into a friendly
  message, so nothing looked broken in logs.
- The ACP client applies a 60s *total* turn cap, so a long but healthy answer
  was silently killed — and because it is a wall-clock race, the same question
  passed once and failed once, which reads as flakiness rather than a defect.
- The CI `enforce` workflow validates PR *evidence structure*, not product
  behavior, so a well-documented PR could still merge a dead reader.

None of this is a call for less testing. It is a call for **asserting on what
the user sees**: rendered canvases with non-zero dimensions, visible text,
working controls — not on IPC return values.

## Gate status at `bc21166`

| Gate | Result |
| --- | --- |
| `test:gate:reading` | Pass |
| `test:gate:chats` | Pass |
| `test:gate:questions` | Pass |
| `test:gate:usage` | Pass |
| `test:gate:collections` | **Fail** — stale selector |
| `test:gate:trash` | **Fail** — identical fixture titles |
| reader renders a real PDF | **Fail** — no gate covers this |

## What G0 still needs

1. Fix the reader so it renders real PDF pages (Finding 1), recovering the true
   underlying pdf.js error rather than trusting the masked one.
2. Stop swallowing the reader's load error, and add a gate that asserts
   rendered output — non-zero-size canvases — not the absence of an error string.
3. Replace the 60s total-turn cap with an idle/stall timeout (Finding 2).
4. Finish the two failing gates (Finding 8) and the open hardening items
   (Findings 6 and 7).
5. Re-run this whole matrix on a fixed build.
6. Independent human review before closing G0.

## Reproducing this audit

```bash
npm install
npm run build
rm -rf data
xvfb-run -a --server-args="-screen 0 1600x1000x24" node test/g0-core-journey.mjs
```

Exit code is non-zero while the reader is broken, and every step prints an
explicit `PASS`/`FAIL`. Raw Codex output is saved to
`test-artifacts/g0-core-journey/codex-answer.txt`.