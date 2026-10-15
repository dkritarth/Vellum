# Method and honest limits of the 2026-10-15 core-journey audit

Companion to [`2026-10-15-core-journey.md`](./2026-10-15-core-journey.md).
This records how the audit was performed and — just as importantly — what it
could not establish.

## Environment

- Headless Linux host. No display, `DISPLAY` unset, `XDG_SESSION_TYPE=tty`.
  All Electron runs used `xvfb-run -a --server-args="-screen 0 1600x1000x24"`.
- Electron 32.3.3, Node 24, electron-vite, Playwright `_electron`.
- `codex` CLI signed in via ChatGPT (`codex login status` → `Logged in using ChatGPT`).
- Codex adapter on PATH: `@agentclientprotocol/codex-acp` 2.2.2. It was **not**
  installed on this host before the audit and was installed during it. A
  previous research note (`docs/research/codex-acp-current-contract.md`)
  documents a different host with the archived `@zed-industries/codex-acp`.

## Test paper

- arXiv `1706.03762`, "Attention Is All You Need" (Vaswani et al., 2017).
- Downloaded from `https://arxiv.org/pdf/1706.03762`.
- 2,215,244 bytes, PDF 1.5, 15 pages. Born-digital, so text extraction and
  search are meaningful.
- Chosen deliberately because it is a paper a reader would actually open, and
  because its slug (`arxiv-1706.03762`) contains a dot — which is what exposed
  the purge defect.

## Procedure

`test/g0-core-journey.mjs` drives the built app with Playwright:

1. Launch Electron, wait for the `bridge: pong` footer.
2. `window.vellum.ingest('1706.03762')` — the real ingest pipeline: classify,
   fetch, convert, extract, write files, upsert row.
3. Assert `paper.pdf` and `paper.md` exist on disk and record their sizes.
4. Click **Library**, assert the title is visible, screenshot.
5. Click the card, wait, assert `document.querySelectorAll('canvas').length > 0`.
6. `askNewChat({ backend: 'codex' })`, subscribe to `onAskUpdate`, `askStart`
   a paper-specific question, stream until `done` or a 300 s bound.
7. Check the reply for paper-specific content.
8. Close and relaunch the app; assert the paper, the chat session and the
   message history all survive.
9. Assert zero renderer console errors and zero `pageerror`s.

Each step prints `PASS`/`FAIL` and the script exits non-zero if any fail.

## What was verified by running, versus inferred

**Verified by running:** every row marked Pass or Fail in the result matrix;
the 0/8 sustained reader render rate; the four-launch bisect of the
cwd-dependent native-binding failure; the byte-exactness of `readPaperFile`;
the `toHex` occurrence counts in the two pdfjs-dist builds; the Codex answer
text and its 141 streamed events; the live 60-second turn timeout that killed a
streaming answer; the live purge failure on master and success after #67; the
sentinel-file proof that #68 leaves `data/` untouched; the pass/fail status of
all six gates.

**Inferred from reading code:** the specific internal mechanism inside the
`bindings` package that produces the cwd-dependent `dlopen` key. The symptom
and the cwd dependence are experimentally established; the precise line-by-line
mechanism inside `bindings` is reasoned from its documented `process.cwd()`
fallback, not proven.

**Explicitly NOT concluded:** that the pdfjs main/worker `toHex` discrepancy is
the *root cause* of the reader failure. It is a confirmed observable, but pdf.js
builds an exception object when `getDocument()` rejects, so that error may be a
secondary failure masking the true cause. An earlier draft of this audit
asserted the root cause; that assertion was withdrawn once the 0/8 measurement
showed the failure is deterministic and the error path is lossy.

**Not established at all:**

- No human ever looked at this app. Every interaction was scripted. Visual
  quality, layout, contrast, focus order and keyboard accessibility are
  **unreviewed**. Screenshot existence is not accessibility evidence.
- Reader navigation, zoom, TOC, in-document search and text selection were
  **never** exercised, because the reader renders nothing at all. Their
  correctness is entirely unknown, not merely unverified — the code paths have
  never executed against a real PDF in this environment.
- The Claude ACP backend was not exercised. Only Codex was. `claude-code-acp`
  is installed but was not run.
- No test used a scanned/OCR-free or image-only PDF, a very large PDF, a
  malformed PDF, or a non-arXiv URL. Ingest robustness beyond one happy-path
  paper is unknown.
- The audit does not evaluate performance: a 40 KB `paper.md` builds a
  reference index in one pass; nothing here says how that behaves on a
  300-page paper.
- `test/g0-core-journey.mjs` writes to the repository's `data/` directory,
  because better-sqlite3 currently cannot open from a foreign cwd (Finding 5).
  Until that is fixed, this audit script is **not** safe to run against a real
  library. #68's `VELLUM_DATA_DIR` override is the intended route; the script
  should adopt it once the native-binding defect is resolved.

## Why the Codex answer counts as grounded

The question asked for the proposed architecture name, the base encoder and
decoder depth, and a verbatim quotation. Codex returned "Transformer", "6
encoder layers and 6 decoder layers", and two quoted sentences that match
`paper.md`, with a `paper.md:33` citation.

This is one paper and one question. It demonstrates that the grounding path
functions — the agent read the file and quoted it, rather than answering from
parametric memory alone. It is **not** a systematic grounding evaluation: there
is no control question about a *different* paper to confirm the agent is not
simply guessing "Transformer, 6 layers" from priors. A proper evaluation would
include negative controls and questions whose answers are absent from the file.

## Reproduction caveat

`test/g0-core-journey.mjs` requires network access for the real arXiv ingest
and a signed-in Codex CLI. It is therefore a manual gate, not a CI test, and
it costs roughly two minutes per run.