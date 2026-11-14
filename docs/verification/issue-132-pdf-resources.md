# Issue 132 PDF resource verification

Verified 2026-11-05 on Linux x64, Electron 32.3.3. Renderer PDF.js 6.1.200;
unpdf 1.6.2 bundles PDF.js 5.6.205. No engine upgrade.

## Resource contract and sources

- [PDF.js document options](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html#~DocumentInitParameters)
  require trailing slashes for font/wasm directories. Renderer uses document-relative
  URLs and `useWorkerFetch: false`; local file loads use the display factory.
- [6.1 binary factory](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/binary_data_factory.js)
  and [display fetch](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/display_utils.js)
  explain missing-base errors and local XHR support.
- [6.1 decoder](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/core/wasm_image.js)
  requires the JS fallback beside wasm. Copy whole `standard_fonts/` and `wasm/`
  directories, including their licenses, from the renderer's installed package.
- [unpdf document interface](https://github.com/unjs/unpdf#advanced-usage)
  accepts document options and an existing proxy for extraction. Installed
  `node_modules/unpdf/dist/index.mjs` confirms both contracts. Destroy owned proxy
  in `finally`, including extraction failure.
- [5.6 Node factory](https://github.com/mozilla/pdf.js/blob/v5.6.205/src/display/node_utils.js)
  passes a string directly to `fs.promises.readFile`. Main requires an absolute
  filesystem directory ending in `/`, **not a file URL**. Build emits fonts beside
  main; source execution reads installed fonts. Main receives no renderer wasm.

Vite emits resources at `out/{renderer,main}/pdfjs/`. Dev middleware serves only
exact package asset names from an in-memory allowlist. No renderer filesystem IPC,
CSP changes, warning suppression, web-security change, or CMap expansion.

## Red and green

- Build regression first failed with ENOENT at generated renderer fonts.
- Reader regressions first failed for absent font/wasm URLs and worker-fetch option.
- Converter regressions first failed for absent explicit document options/cleanup.
- First live implementation exposed an unreadable main `file://` font path. New
  failing regression required an absolute readable filesystem path before fixing it.
- Final `npm test`: **43 files, 385 tests passed**. `npm run typecheck`,
  `npm run build`, and `git diff --check` passed. Existing jsdom canvas diagnostics
  remain in mocked Reader tests; these are not evidence of real rendering.
- Build regression compares every emitted asset byte with installed package files.
  Separate live check compared all **45** files inside `app.asar`; every renderer
  asset, including fallback JS/licenses, also returned matching bytes over dev HTTP.

## Actual Electron exercise

Source hep-th/9905111 PDF SHA-256:
`4155953f31246cd11122cfac5527b1c7fa2e64bf407593af9067f2cc85629fc7`.
Source supplied locally; no network metadata or signed-in ACP required.

Node/Playwright harness `/tmp/vellum132-live.mjs` used visible Create, local path
entry, Add Paper, Library, page navigation, and Notes controls. Fresh isolated
`VELLUM_DATA_DIR` and Electron profile per mode; empty adapter PATH. Launch cwd
was each isolated `/tmp` directory in final runs. No personal browser/auth state.

Baseline actual app reproduced wasm, null fallback module, Type3, font, and Symbol
warnings. Final dev HTTP (`npm run dev -- --noSandbox`), built file:// Electron,
and unpacked Linux package each passed:

1. Ingest exact PDF and finish Reader's all-261-page text scan, observed through
   loading completion without Reader error.
2. Render PDF pages 1, 27, 30 at 612×792. Text spans: 72, 257, 40 respectively.
   Page 27's tiny momentum label below left diagram line is restored. Inspect
   page 30 and unaffected first page. No whole-document visual fidelity claim.
3. Save note through Notes textarea, navigate through Library, reopen page 1.
4. Close/relaunch, reopen pages 27/30, verify saved note and identical stored PDF
   hash. Font and jbig2 responses return 200, including actual `app.asar` URLs.
5. No missing wasm/font/fallback-module/Type3 warnings, failed requests, or renderer
   page errors. Main font load warning eliminated. Main still logs five supported
   `CCITTFaxStream: Falling back to JS CCITTFax decoder.` messages during ingest.

Separate empty-state/missing-file modal exercise passed visible error recovery,
modal autofocus, Tab focus, labels, Cancel, and empty Library. Host D-Bus errors
remain; dev bootstrap also logged a GPU initialization diagnostic. No suppression.

## Local evidence and distribution limits

- `/tmp/vellum132-live-baseline/`: `result.json`, `page-{1,27,30}.png`, restart
  screenshots; `diagram-27.png` crops the before image.
- `/tmp/vellum132-live-{built-final,dev-final,packaged-final}/`: `result.json`
  contains main/renderer logs, resource responses, samples, and persistence result;
  `page-{1,27,30}.png`, `restart-page-{27,30}.png` are actual-app screenshots.
- `/tmp/vellum132-ui-errors/`: `result.json`, `missing-file.png`, `empty-library.png`.
- `/tmp/vellum132-{build-red,reader-red,convert-red,main-path-red}.log` and
  `/tmp/vellum132-{build-green,runtime-green,main-path-green,full-test,typecheck,build,package}.log`.
- `/tmp/vellum132-asset-integrity.json`: archive and HTTP byte comparisons.
- Disposable investigation report `/tmp/vellum132-prototype-report.md` and its
  prototypes remain outside git. Actual-app evidence above establishes this fix.

Package command: `npx electron-builder --linux --dir --config.npmRebuild=false`.
Output `dist/linux-unpacked/vellum`, resources inside `resources/app.asar`.
Existing native addon was copied only to generated `out/resources/native/` for
launch/package testing. Node addon backup `/tmp/vellum132-node-binding.node`;
both installed Node addon and tracked Electron addon retain original SHA-256.
No native binding or packaging-path fix is included. Existing #100 work stays
separate. Package smoke establishes these resource paths in this Linux environment;
no clean-machine installer, Windows, macOS, signing, or native rebuild verification.

Known visible text-layer misalignment (#86 / #95) remains. Reader cancellation
(#99) remains separate. No ACP validation, phase unlock, or independent review
claimed. No generated resource blobs or screenshots committed.
