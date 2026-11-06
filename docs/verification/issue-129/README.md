# Issue 129: local PDF picker

Verified 2026-11-05 on Linux with Electron 32.3.3, Node 24.19.0 and Playwright 1.63.0. Branch starts at `origin/master`, not any other open draft.

## Contract and change

Electron 32 [removed File.path](https://www.electronjs.org/docs/latest/breaking-changes#removed-filepath). The replacement, [webUtils.getPathForFile](https://www.electronjs.org/docs/latest/api/web-utils#webutilsgetpathforfilefile), resolves a disk-backed File locally in preload and returns an empty string for a constructed File. Native Electron validates the argument. The renderer receives only the resolved string. No File enters main-process IPC.

The disposable investigation in `/tmp/vellum-picker-investigation.md` confirmed this contextBridge contract before implementation. No prototype code ships. `src/vellum.d.ts` already derives its method types from `VellumApi`; the new method is included automatically.

## Red and green

Before the fix, the new full-path selection test failed because the path resolver was never called. Five existing tests passed. After the first fix, four new cases failed for empty return, thrown error, missing method and missing bridge. All now pass, including same-file retry, cancellation, Unicode/spaces and existing manual identifiers, URLs and paths.

Preload tests check the exposed bridge, native call results/errors, and absence of IPC calls. The existing main contract test now excludes the local resolver from its list of IPC requests. No main handler or core implementation changed.

Final checks:

- Focused component/preload tests: 16 passed.
- `npm test`: 391 passed across 42 files.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Existing Reader tests emit jsdom canvas-not-implemented stderr while passing.
- One intermediate suite run overlapped a native rebuild and lost four workers. The final full suite ran with the restored Node binding and passed.

## Live procedure and observations

Run `npm run dev` on an isolated Xvfb display with fresh `VELLUM_DATA_DIR` and `--user-data-dir`. Only Node and system executables were on PATH, so ACP adapters were unavailable. Rebuild this checkout's better-sqlite3 binding for Electron 32.3.3 before launch. Back it up first and restore afterward. The Node binding SHA-256 before and after matched `45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`.

1. Click Library, verify the empty state, then click Create. Confirm labeled identifier input has focus and empty Add Paper is disabled.
2. Type a prior path and cancel file selection with `setInputFiles([])`. The prior text remains.
3. Construct a File in the renderer. Native resolver returns `''`. Assign it to the actual input and dispatch change. The alert explains how to retry or enter a full path. Prior text clears, Add Paper stays disabled, and the library stays empty.
4. Click Choose local PDF. Populate the actual file input with `setInputFiles` using real bytes of *Attention Is All You Need*, arXiv 1706.03762, copied to a path ending `论文 Attention paper.pdf`. Confirm the full path and cleared alert, then click Add Paper. Loading disables Add Paper and Cancel.
5. Confirm import closes the modal, reader reaches page 1 of 15, Loading disappears, and canvas contains rendered pixels. The persisted PDF matches the source byte-for-byte; paper.md contains extracted paper text. Click Library and confirm one paper card.
6. Stop the process, restart with the same isolated data/profile, click Library, reopen the card and confirm the PDF renders again. The complete library row matches before restart.

Playwright used a local CDP connection to the Electron dev process. A default remote CDP connection synthesizes Files when uploading and cannot prove disk-path resolution. A separate Playwright Electron launch also confirmed native resolution of both ASCII and Unicode disk paths.

## Evidence and limits

- [Path error](path-error.png), [resolved full path](resolved-path.png), [library](library.png), [reader after restart](restart-reader.png).
- Renderer console: no warnings, errors or page exceptions. DevTools/Vite informational messages appeared. Electron stderr included GPU initialization and DBus errors under Xvfb, plus a zygote termination error during shutdown. The console was not wholly clean across processes.
- The OS-native file chooser was not automated. The visible Choose button was clicked and Playwright populated the actual input.
- The current master reader has a misaligned visible text overlay; existing [PR #95](https://github.com/dkritarth/Vellum/pull/95) tracks that defect. This change verifies PDF raster rendering and persistence, not selection alignment.
- No signed-in ACP run occurred. Missing adapters triggered existing degraded ingestion: title fell back to the source path, authors and sections were empty, and no agent summary was produced. This proves picker path resolution and local conversion/storage/reader behavior only.
- Standards and issue-contract self-review found no remaining change-specific defects. Independent parent integration/live review remains outstanding. No merge or phase unlock performed.
