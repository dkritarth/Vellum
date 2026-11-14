# Local PDF byte limit verification

Verified on Linux, 2026-11-05. Scope: issue #121, `fetchSource` local branch only.

## Regression and automated checks

- Before fix, `npx vitest run core/ingest/fetch.test.ts -t 'one byte over'`
  failed: five-byte local file resolved despite `maxBytes: 4`.
- Against stat-only implementation, `-t 'growth beyond'` failed: real file
  grew from four to five bytes after stat and still resolved. Bounded reads fixed it.
- Focused fetch suite: 30 passed. Full `npm test`: 41 files, 392 tests passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Coverage: below/exact/over custom cap, zero-byte cap, sparse default-cap rejection,
  directory/FIFO rejection, missing file, multi-read contents, growth after stat,
  and closed handles on success, size rejection, stat failure, and read failure.
  Filesystem fault/race injection uses real temporary files and handles.

## Live Electron

Production build launched through Node Playwright under Xvfb, using existing
`test/harness.mjs`. Temporary data/config/cache directories isolated state;
temporary adapter executables exited 127 to avoid signed-in model requests.

1. Click Library: empty library. Click Create: labelled input focused; empty
   submission disabled.
2. Type sparse local PDF path, 52,428,801 bytes. Click Add Paper. Alert displayed
   `Local PDF exceeds maximum allowed size of 52428800 bytes`; input re-enabled.
3. Replace input with downloaded real paper from <https://arxiv.org/pdf/1706.03762>.
   Click Add Paper. Modal closed; reader rendered page 1 of 15, including
   `Attention Is All You Need`. Stored PDF and markdown remained local.
4. Close and relaunch using same isolated data directory. Click Library, then
   persisted paper. First page rendered again; one paper persisted, oversized
   input absent.

Local evidence: `test-artifacts/issue-121/{live.mjs,live.log,console.log,oversize.png,success.png}`.
Artifacts are ignored, not included in this commit. Captured renderer console
after window attachment contained no warnings/errors; main-process stderr and
earliest startup messages were not captured. Used production build, not dev server.
Metadata extraction degraded as expected without adapter; no ACP capability claim.
Windows/macOS live paths untested. Existing visible text-layer duplication is #86.

## API basis and self-review

Official Node documentation: [`FileHandle.read`](https://nodejs.org/api/fs.html#filehandlereadbuffer-offset-length-position)
reports actual bytes read, with zero marking EOF for an unchanged file; `null`
position advances file offset. [`O_NONBLOCK`](https://nodejs.org/api/fs.html#file-open-constants)
opens nonblocking when possible, allowing FIFO validation without waiting for writer.
The opened handle is statted and closed in `finally`; reads request at most the
remaining cap plus one byte, so growth cannot trigger unbounded buffering.

Inline self-review against `origin/master`: standards and issue contract passed.
No renderer/IPC change, new public seam, remote fetch behavior change, or overlap
with #118 HTML MIME handling, #107 timeouts, #104 SSRF, or #96 identity.
Independent review remains pending; issue remains in progress and PR stays draft.
