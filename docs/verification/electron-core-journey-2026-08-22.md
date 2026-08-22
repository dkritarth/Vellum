# Electron core-journey audit — 2026-08-22

Issue: [#26](https://github.com/dkritarth/Vellum/issues/26)

Commit under test: `a21d596e3fca6de7edef1e63576a8beb00183e5e`

Result: **failed at boot and entry-to-ingest boundaries; downstream journey blocked**

## Test isolation and control

- Ran from detached worktree `/tmp/vellum-issue-26-audit.ikQaIL`; its `data/`
  started absent. Normal checkout `data/` was neither read nor mutated.
- macOS Accessibility permission was unavailable. Renderer checks used a
  temporary Playwright/CDP controller against the real Electron process.
  Main-process output came from `ELECTRON_ENABLE_LOGGING=1` PTY capture.
- Temporary worktree-only bypasses were used to expose later failures:
  preload path changed from missing `index.js` to emitted `preload.mjs`, and
  `better-sqlite3` was externalized. None exists in this branch.
- Electron control limits and primary-source basis are recorded in
  [`../research/issue-26-electron-control.md`](../research/issue-26-electron-control.md).

## Real paper fixture

Planned input: `1706.03762` / `arXiv:1706.03762v7`.

Expected metadata from the [official arXiv record](https://arxiv.org/abs/1706.03762):

- Title: *Attention Is All You Need*
- Authors: Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit,
  Llion Jones, Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin
- First submitted: 12 June 2017; tested record version: v7, 2 August 2023
- Length: 15 pages, 5 figures
- Key factual grounding checks planned: Transformer uses attention without
  recurrence/convolution; reported WMT 2014 scores are 28.4 BLEU for
  English-to-German and 41.8 BLEU for English-to-French.

The app never exposed a working ingest path, so it did not download or persist
this paper. Metadata above records expected values; it is not claimed as Vellum
output.

## Results matrix

| Core step | Result | Observed evidence |
|---|---|---|
| Clean isolated start | Pass | Detached worktree began without `data/`; normal checkout stayed untouched. |
| Production/dev preload bridge | **Fail** | Build emitted `out/preload/preload.mjs`; Electron requested `out/preload/index.js`; status remained `bridge: …`. Filed [#51](https://github.com/dkritarth/Vellum/issues/51). Screenshot: [`issue-26/01-preload-failure.png`](issue-26/01-preload-failure.png). |
| Empty reader state | Pass after temporary preload bypass | Visible `No paper open` and `Open a paper from Library to start reading`; status `bridge: pong`. Screenshot: [`issue-26/02-empty-state.png`](issue-26/02-empty-state.png). |
| Create / ingest entry | **Fail** | Semantic click on **Create** produced no visible or accessible-tree change; no input or dialog appeared. Filed [#53](https://github.com/dkritarth/Vellum/issues/53). |
| Input classification | **Fail — blocked** | No user-facing ingest input exists. Direct IPC was not substituted for the required user journey; #53. |
| Real arXiv ingest | **Fail — blocked** | #53 prevents initiation; #52 prevents first DB-backed operation. |
| Re-ingest / idempotency | **Fail — blocked** | No first ingest completed because of #52 and #53. |
| Library empty state | **Fail** | Unmodified app emptied the renderer and logged `window.vellum`/`listPapers` TypeError (#51). With preload temporarily bypassed, it showed `Could not load your library.` and main threw the native-binding error (#52). |
| Library loading state | **Fail — not verified** | Transition was too brief to capture before #52; no loading-state claim made. |
| Library search and sort | **Fail — blocked** | #52 prevents a successful Library query. |
| Open paper tab | **Fail — blocked** | #52 and #53 prevent creation of a paper record. |
| PDF render and page navigation | **Fail — blocked** | #52 and #53 prevent ingest/open. |
| Zoom, TOC, document search | **Fail — blocked** | #52 and #53 prevent Reader from receiving a paper. |
| Details and generated summary | **Fail — blocked** | #52 and #53 prevent paper record/markdown creation. |
| Model selector | **Fail — blocked** | #52 and #53 prevent opening a paper/session. |
| Codex factual question and grounding check | **Fail — blocked** | No paper markdown/session is reachable; prior #25 adapter smoke is not substituted for this journey. |
| Codex interpretive question | **Fail — blocked** | Same #52/#53 blocker. |
| New chat | **Fail — blocked** | #52/#53 prevent a paper chat from opening. |
| Chat persistence across reload | **Fail — blocked** | #52/#53 prevent chat creation. |
| App restart persistence | **Fail / blocked** | Repeated fresh launches reproduced #51. Temporary-bypass launches reproduced #52; no durable paper/chat state could be created to test round trip. |
| Failure state | Pass | Library rendered `Could not load your library.` after #52. |
| Renderer console | Pass for captured post-load window | No renderer page errors were observed after the temporary preload bypass; [`issue-26/last-renderer-console.json`](issue-26/last-renderer-console.json). This does not cover preload-time errors. |
| Main-process console | **Fail** | Exact preload and SQLite errors below. |
| Keyboard/accessibility labels | Partial pass | Empty-state accessibility tree exposed named navigation buttons, `Paper view`, right-panel tabs, `Highlight`, `Skills`, `Context`, and disabled `Ask a question`. Focus reached clicked `Library`. Full reader/chat order was blocked. |

Machine-readable action/result transcript: [`issue-26/interaction-journal.json`](issue-26/interaction-journal.json).

## Exact console failures

Unmodified preload startup:

```text
Unable to load preload script: .../out/preload/index.js
Error: Cannot find module '.../out/preload/index.js'
```

Library after temporary preload bypass:

```text
Error occurred in handler for 'vellum:list-papers': Error: Could not dynamically require
".../out/build/Release/better_sqlite3.node". Please configure the
dynamicRequireTargets or/and ignoreDynamicRequires option of
@rollup/plugin-commonjs appropriately for this require call to work.
```

Generated `out/main/index.js` contained `commonjsRequire(filename)` for the
native addon and resolved it under `out/build/Release/`, where no addon exists.
Captured excerpts: [`issue-26/main-console.txt`](issue-26/main-console.txt).

## Filed failures

1. [#51 — Electron dev boot cannot load preload bridge](https://github.com/dkritarth/Vellum/issues/51)
2. [#52 — Bundled better-sqlite3 cannot load native binding in Electron](https://github.com/dkritarth/Vellum/issues/52)
3. [#53 — Create control cannot start paper ingest](https://github.com/dkritarth/Vellum/issues/53)

Each issue includes severity, expected/actual behavior, exact reproduction,
suspected ownership, evidence, and explicit non-goals. All remain blocked; this
audit made no product fix.

## Automated verification

- `npm run typecheck`: passed.
- `npm run build`: passed. Build output itself reproduces #51 by emitting
  `out/preload/preload.mjs` while unmodified main expects `index.js`.
- Focused `npx vitest run core/acp/stdio-client.test.ts`: 18/18 passed.
- Final `npm test`: 147/147 passed across 24 files. Initial full run was
  146/147 because `dispose() does not resolve until the adapter subprocess
  exits` failed once; focused and final full reruns passed. Existing jsdom
  canvas-not-implemented stderr remained non-failing test noise and is not PDF
  rendering proof.
- `git diff --check master...HEAD`: passed.

## Limitations

- Native macOS dialogs were not exercised because Accessibility permission was
  unavailable and no dialog was reachable.
- Loading-state screenshots, real-paper reader evidence, signed-in Codex Ask,
  and persistence evidence are absent because boot-critical defects prevented
  those states. These are recorded as blocked, not passed.
- Temporary package/install experiments in the detached worktree were audit
  tooling only. They are not implementation recommendations or acceptance
  evidence for any filed defect.
