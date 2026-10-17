# Electron restoration and integration verification

Tested 2026-10-17 in isolated Linux Electron processes under xvfb. Product baseline was f37818d. Startup restoration is ba22773; combined verification branch df5d067 also includes issue #71 ACP idle timeout, #66 distinct fixtures, #77 Trash-preserving re-ingest, and #76 recoverable purge. Sibling PRs remain separate; combined results do not imply each original broken-base branch passes every check alone.

## Automated results

- Before restoration: both startup/preload-contract tests fail; main process ends after ingest registration and typecheck fails.
- After restoration: both tests pass, all 32 preload request channels have registrations, and typecheck/build pass.
- Combined final suite: 364 tests pass across 41 files. Typecheck, production build and diff check pass.
- Existing jsdom canvas-not-implemented stderr remains test noise. Rendering was separately exercised in Electron.

## Parent live procedure

All paper/database content used temporary VELLUM_DATA_DIR roots. The real-paper journey also used separate XDG_CONFIG_HOME and XDG_CACHE_HOME. Source was the public arXiv 1706.03762 PDF, Attention Is All You Need.

1. Click Library; check empty state.
2. Click Create; check input focus; type the local real-PDF path and click Add Paper. Check loading state and rendered canvas.
3. Click Notes, type a note and wait for autosave.
4. Click Library, move paper to Trash, open Trash, then re-ingest identical source through Create. Verify unchanged Trash timestamp and empty active Library.
5. Restart. Open Trash, click Restore, open paper from Library and verify persisted note.
6. Click Ask; select Codex; ask for architecture, encoder/decoder depth, exact quotation and section. Verify returned answer against actual paper text.
7. Restart again; reopen paper and Ask. Verify conversation persists. Check renderer console has no errors or warnings.

Initial ingest deliberately used an empty adapter PATH to exercise degraded metadata. It still converted and rendered the real PDF; its title therefore fell back to the source path. Restart restored the normal PATH for signed-in Codex Ask. No API-key path or subscription OAuth bridge was used.

Codex answered Transformer, six encoder and six decoder layers, and quoted section 3.1. Separate signed-in ACP smoke returned pong/done. A separate real Codex turn reading the same paper completed after 120,303 ms while emitting progress across seven ten-second checkpoints, proving productive turns survive the former 60-second total cap.

## Gate results

Each command exited 0 under xvfb: test:gate:collections, test:gate:trash, test:gate:reading, test:gate:reader, test:gate:chats, test:gate:questions and test:gate:usage. The reader gate included five repeated fixture opens and real arXiv rendering. Final Trash gate ran after integration of recoverable purge and checked associated state, confirmed deletion, removed files and second-paper isolation.

Implementation agent independently verified startup, empty/error UI, real-PDF ingestion/rendering and restart from repository cwd and a different cwd. Its renderer console was clean; main logs contained expected missing-file IPC rejection and a host D-Bus diagnostic, with no native-binding error. Parent renderer console was clean.

## Screenshots and limitations

[codex-real-paper.png](codex-real-paper.png) and [restart-chat.png](restart-chat.png) show real-paper rendering and persisted signed-in Codex conversation. The screenshots also reveal a pre-existing misaligned visible PDF text overlay, tracked in #86. Canvas rendering success does not imply text-layer layout correctness.

Parent harness failures were corrected without product edits: an incorrect role=log locator, a rebuild/restart overlap, and an unscoped canvas locator matching PDF.js's temporary probe canvas. The final stable-build run completed every step above.

Other discovered defects remain tracked in #78 source collisions, #79 note-load race, #80 Ask paper-switch state, and #83 IPC option validation. Native OS file picker was not tested. These five fixes do not certify all product paths or unlock milestone gates.

Purge rollback is tested with lock, DELETE, COMMIT and filesystem failures. Cross-resource crash atomicity is not claimed; recovery directories can need manual intervention after a crash or failed restoration.
