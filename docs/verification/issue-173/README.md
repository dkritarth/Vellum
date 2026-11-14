# Issue 173 verification

Base: #161, `503235618c5709ebacc6426516752e77ea208122`. Changes limited to Reader annotation navigation, Reader regression tests, and this evidence directory.

Annotation jumps now reuse `goToPage`, which already retires Selection actions before changing page. Same-page jumps also retire actions. Flash destination and timer remain unchanged. No schema, backend, search ownership, PDF disposal, or highlight changes.

## Automated evidence

- [red.txt](red.txt): both new public Reader cases fail before production edit because outgoing Selection actions remain, on same-page and cross-page annotation jumps.
- [green.txt](green.txt): all 67 Reader tests pass after fix. New tests cover retirement, page/destination flash, fresh Add to chat quote/page, unchanged jump-target rerender, and repeated same-page requests. Existing flash expiry, search, navigation, loading/error, highlight and disposal tests remain passing.
- [tests.txt](tests.txt): `npm test`, 41 files, 408 tests pass.
- [typecheck.txt](typecheck.txt): `npm run typecheck` passes.
- [build.txt](build.txt): `npm run build` passes.
- `git diff --check` passes.

The earlier independent proof in `/tmp/vellum-reader-jump-selection-repro/` showed annotation navigation failing and normal Next passing. Callback retains original quote/page; this change does not fix or claim wrong-page persistence.

## Live Electron

Linux Electron 32, Xvfb, Playwright. Real 15-page *Attention Is All You Need* PDF, source `/tmp/vellum-121-attention.pdf`, SHA-256 `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`. PDF bytes copied into a fresh `/tmp/vellum173-live-*` state directory, separate Electron profile. No corpus, credentials, subscription adapter or model calls. Library metadata seeded to reach Reader directly; ingest not tested. `paper.md` contains a verification marker, not extracted paper text.

[Harness](live.mjs), [built results](live-results.json), [built run](live.txt), [dev results](dev/live-results.json), [dev run](dev/live.txt).

1. Open real paper via Library. Annotations initially shows no highlights. Double-click native title text on page 1 and use Selection actions to create yellow highlight. Click Next, double-click native `Introduction` on page 2 and create green highlight.
2. Type note and wait for Saved. Reopen Annotations to load both stored rows.
3. Click page 1 row, double-click native `All`, confirm Selection actions. Click visible page 2 row. Observe page 2 raster/text, removed outgoing actions, green highlight flash, row focus.
4. Select page 2 text and click same-page annotation. Actions disappear. Wait for flash expiry, press Enter on focused row, observe renewed flash and retained focus.
5. Click rows 1, 2, 1 without waiting for intermediate rendering. Latest destination renders with flash, no old actions.
6. Jump to page 2, double-click native `Introduction`, click Add to chat. Ask input contains `> "Introduction" (p. 2)` and receives keyboard focus. No Send click. Native single-line input strips prompt newlines.
7. Restart Electron with same isolated state/profile. Open paper. Both stored highlights remain, page 2 annotation still navigates/flashes, note remains `Issue 173 preserved research note`.

Built run:

```bash
npm run build
xvfb-run -a node docs/verification/issue-173/live.mjs
```

Dev repeat also passed all steps. Start renderer from `npm run dev` with an isolated empty app/profile, then launch controlled Electron against it:

```bash
ELECTRON_CLI_ARGS='["--user-data-dir=/tmp/vellum173-dev-profile"]' \
VELLUM_DATA_DIR=/tmp/vellum173-dev-empty \
xvfb-run -a npm run dev -- --rendererOnly --noSandbox

LIVE_RENDERER_URL=http://localhost:5173 \
LIVE_EVIDENCE_DIR="$PWD/docs/verification/issue-173/dev" \
xvfb-run -a node docs/verification/issue-173/live.mjs
```

Dev server and Electron processes stopped after verification. Dev screenshot duplicates omitted to keep artifacts small.

## Injection and native module ownership

Only disposable `out/main/live173.cjs` is instrumented. Exact injected code appears in each results JSON: one `upsertPaper(getDb(), <metadata>)` before the existing `createWindow()`. Bundle removed in harness `finally`. No renderer injection, Selection/Range fabrication, mocked IPC, PDF.js replacement, seeded highlight/note, or model invocation. All highlights and note created by visible clicks/typing and saved through real IPC/SQLite.

Existing committed `resources/native/better_sqlite3.electron.node` works directly. No native rebuild or SQLite replacement needed; Node tests finish before live runs. Native file Git blob remains exactly `abefb82d9cd499731a6893f16d53589bb40e2786`. Parent checkout and dependencies untouched.

## Visual and console evidence

- [Outgoing native selection](outgoing-selection.png)
- [Cross-page retirement and destination flash](cross-page-retired.png)
- [Same-page flash](same-page-flash.png)
- [Fresh destination quote and focus](destination-chat-context.png)
- [Restart preserves research state](restart-preserved.png)
- [No paper open](empty.png)

Built and dev renderer consoles have zero errors, warnings or pageerrors: [built console](console.txt), [dev console](dev/console.txt). Main-process stderr is retained separately: [built stderr](main-stderr.txt), [dev stderr](dev/main-stderr.txt). Xvfb host emits GPU initialization and DBus errors; dev also emits normal Vite/React development messages. These did not prevent real PDF rendering or persistence. No claim of completely silent host stderr.

## Self-review and limits

Reviewed inline, without subagents, against AGENTS.md/CLAUDE.md and issue #173, using both review axes. Standards: no findings. Spec: no findings. Single production line uses existing navigation path; flash/nonce timer and search/disposal ownership remain intact. Scope confined to owned Reader files and evidence. No new seam or state model.

Independent reviewer has not repeated this procedure. Draft only. Linux only; no signed-in ACP, other OS, ingest, full-document visual-fidelity, or wrong-page-storage claim. Existing error/loading/search/disposal paths covered by regression suite; no new live failure injection. No merge, watch, or phase unlock.
