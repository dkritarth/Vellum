# #89 Linux packaged runtime verification

Verified 2026-10-23 on Ubuntu 24.04.4 x86_64, Node 24.19.0, npm 11.17.0,
Electron 32.3.3 and electron-builder 25.1.8. Base: `757b5f8`.
Worktree: `/home/dandapat/.t3/worktrees/Vellum/t3-93108480`.

Recovered committed path/build changes from Vellum2 commits `9febbe4`, `64f6e45`
and `1a4ca1e` using read-only `git show`. Old checkout/index untouched. Preserved
current main-process handlers and IPC regression cases. No nested delegation.

## Result and limits

Extracted Linux archive launches from a foreign cwd with working preload and SQLite
under the repository harness's `--no-sandbox` convention. Packaged default state is
`<app.getPath('userData')>/data`; neither launch cwd receives `data/`. Explicit
`VELLUM_DATA_DIR`, legacy override and source cwd behavior remain supported.
SQLite loads `resources/native/better_sqlite3.node` outside app.asar. Removing that
resource from the isolated extracted copy fails at that exact path, without a
repository fallback. The resource is restored after the negative test.

A real [Attention Is All You Need PDF](https://arxiv.org/pdf/1706.03762), 15 pages,
was added through Create and Add Paper. Canvas text pixels and selectable PDF text
were checked. A note was typed and autosaved through Notes. A user question and an
assistant reply were sent through Ask using an **offline local ACP wire fixture**.
Fixture reads the actual paper.md resource link. Restarting the extracted executable
from a different cwd retains library, PDF, markdown, note, selected backend and both
messages. This verifies storage and transport, not a signed-in model or model
answer grounding. Metadata deliberately degrades with unavailable Claude adapter;
the source path appears as title. No model service or raw API keys were used.

**Default sandbox-enabled desktop startup remains unverified.** Direct no-flag
executable launch on this host aborts with SIGTRAP because extracted chrome-sandbox
lacks root ownership/mode 4755. No system sandbox settings or helper ownership were
changed. Product code does not add `--no-sandbox`. Keep #89 unverified for default
installation; do not treat this draft as desktop release certification.

Screenshots also reproduce existing [Reader text-layer defect #86](https://github.com/dkritarth/Vellum/issues/86).
Canvas renders, but pale text is duplicated and misaligned. Screenshots capture
background reference indexing. No reader usability or selection certification.

## Before and after

Baseline unconfigured Linux directory package on `757b5f8` launches from foreign
cwd. Preload returns `pong`, SQLite lists `[]`, and it creates `cwd/data/app.db`.
**No baseline native-loader defect reproduced.** `baseline-runtime.mjs` records the
actual app paths and asserts this misplaced database.

The new main/preload regression fails before the path fix:

```text
reads packaged paper files and opens SQLite under userData rather than the launch directory
AssertionError: expected null not to be null
1 failed | 15 passed
```

After the fix, the same actual preload method reads the PDF under userData and
asserts SQLite opens `userData/data/app.db`. Focused path/startup checks pass,
19 tests across 2 files. Path tests cover cwd independence, absolute/relative and
legacy overrides, blank override fallback, and source data/native paths.

Fresh verification also caught stale Electron rebuild metadata. Baseline packaging
writes `.forge-meta` with `x64--128`; a later Node rebuild replaces the binary with
ABI 137 but leaves that marker. Builder skips rebuilding and copies the wrong ABI.
The extracted candidate then fails live with `NODE_MODULE_VERSION 137` where
Electron requires `128`. This is a reproduced packaging-sequence failure, separate
from the working baseline loader. `npm run dist` now forces the supported
`electron-rebuild --force --only better-sqlite3` before builder. Repeating the same
sequence produces the Electron binding and the complete archive probe passes.
See [primary-source research](../../research/packaged-linux-runtime.md).

## Automated and live commands

`npm ci` created a real, isolated node_modules directory. Only this worktree's
native dependencies were rebuilt. No shared node_modules or tracked native binary
changed. All checks below passed, including final Node ABI restoration.

```bash
npm ci
npx vitest run electron/main.test.ts electron/paths.test.ts
npm test
npm run typecheck
npm run build
npm run dist
# Use fresh isolated artifact state. Existing verification state is retained.
mkdir -p test-artifacts/issue-89/extracted test-artifacts/issue-89/final
curl -LfsS https://arxiv.org/pdf/1706.03762 -o test-artifacts/issue-89/final/attention.pdf
tar -xzf release/vellum-0.1.0.tar.gz -C test-artifacts/issue-89/extracted
ulimit -c 0
xvfb-run -a node docs/verification/issue-89/packaged-runtime.mjs test-artifacts/issue-89/final test-artifacts/issue-89/extracted/vellum-0.1.0
# Restore Node ABI after packaging, then verify again.
npm rebuild better-sqlite3
npm test
npm run typecheck
npm run build
git diff --check
```

Final full suite: **42 files / 384 tests passed**. Typecheck, production build,
archive creation, both verification scripts' syntax checks and whitespace checks
pass. app.asar has 881 entries; inspected allowlist excludes repository sources,
runtime state, test artifacts and repository-native resources.

The live script uses visible controls for Library, Create/Add Paper, invalid-PDF
error/recovery, Notes, Ask, backend selection and restart. It checks initial input
focus, accessible labels, disabled/empty states and persisted contents.
Source/override/native-negative probes use the actual preload bridge. The fixture
never opens a signed-in adapter. Default sandbox probe invokes the executable
without Playwright flags through GNU timeout.

## Artifacts and diagnostics

Archive: `release/vellum-0.1.0.tar.gz`, 131,825,967 bytes.
SHA-256: `9732b85ba9f63a031623a676f7bba793fa0a74d1c4b339e41715d2e2af09bec6`.
PDF SHA-256: `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.

All local artifacts are under `test-artifacts/issue-89/` in the worktree:

- `red-main.log`, `green-focused.log`, final tests/typecheck/build logs.
- `baseline-package/`, `baseline-runtime.json`, `baseline-live.log`.
- `stale-abi-diagnostics.json`, `stale-abi-live.log`, `package-force-rebuild.log`.
- `extracted/vellum-0.1.0/`, final archive launch `packaged-live-final.log`.
- `final/runtime.json`, `final/diagnostics.json`, `final/fixture-reads.jsonl`.
- Retained state: `final/config/vellum/data`; cwds: `final/launch-one`, `final/launch-two`.

Final archive probe exits 0. All five renderer launches record **zero errors and
warnings**. Main diagnostics contain intentional invalid-PDF parsing/indexing
messages, expected missing-native errors in the negative probe, Xvfb DBus timeouts
and Playwright debugger shutdown messages. Normal launches have no SQLite/native
load errors. An earlier harness attempt caused Canvas2D readback warnings; the
final probe reads pixels once and records none.

Direct default launch reports:

```text
FATAL:setuid_sandbox_host.cc(163): The SUID sandbox helper binary was found, but is not configured correctly.
You need to make sure that .../chrome-sandbox is owned by root and has mode 4755.
```

[Packaged note](packaged-note.png) · [Offline chat](packaged-chat.png) ·
[Chat restored after restart](packaged-restart.png)

## Self-review and remaining verification

Standards: changes stay in data/native bootstrap, packaging and #89 evidence.
Existing IPC handlers, renderer isolation, storage split and validation remain
intact. No schema/authentication changes, generated bundles or credentials added.

Spec: path/native checks and offline real-paper persistence pass. Default sandbox
startup, signed-in Codex and other operating systems remain unverified. Existing
cwd-based data remains accessible through `VELLUM_DATA_DIR=/absolute/old/data`;
the new packaged default does not move it. Parent owns independent review and
integration. Issue labels and phase gates remain unchanged. Draft only; no merge.
