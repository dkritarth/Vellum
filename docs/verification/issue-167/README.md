# Issue #167 verification

Only the newest refresh in a mounted CollectionsTree may publish tree, load-error, or loading state. Initial loads, one-second polls, and post-mutation reloads share a local sequence. Effect cleanup invalidates pending responses. Mutation handlers, selection behavior, backend counts, IPC, schema, and CSS remain unchanged.

Base: [#115](https://github.com/dkritarth/Vellum/pull/115), `fix/collections-tree-polish`, `2d00efc45f1f6a3de12fcf5f97d3dde3863b0791`, above [#113](https://github.com/dkritarth/Vellum/pull/113). Issue [#167](https://github.com/dkritarth/Vellum/issues/167) was already claimed with `status:in-progress` and contains the implementation plan.

## Automated evidence

- [Red](red.txt): actual component tests before production edits. Two stale initial response tests failed; nine existing tests passed. Public New Collection, input, and Add controls reproduced the supplied proof.
- [Focused](focused.txt): 17 pass. Adds initial success/error ordering, loading ownership, current failure/recovery, stale success preserving current errors, rename/delete reload ordering, unmount interval cleanup, and StrictMode effect restart coverage.
- [Full suite](tests.txt): 41 files, 394 tests pass. Existing mutation-error tests continue to pass; their deliberately logged errors remain in the output.
- [Typecheck](typecheck.txt), [build](build.txt), and `git diff --check` pass.
- [Native restore](native-restored.txt): original Node better-sqlite3 binary copied before Electron rebuild, restored byte-for-byte with `cmp`, and opened successfully under Node afterward. No Node tests overlapped Electron native setup or execution.

## Reproduce live verification

Use Node/TypeScript tools only. Run from repository root with dependencies installed:

1. Run `npm run build`.
2. Copy `node_modules/better-sqlite3/build/Release/better_sqlite3.node` to a safe temporary path. Record its SHA-256.
3. Run `npx electron-rebuild --force --only better-sqlite3`. Do not run Node SQLite tests until restoring the original binary.
4. Run `xvfb-run -a node docs/verification/issue-167/live.mjs /absolute/path/to/attention-is-all-you-need.pdf`.
5. Run `xvfb-run -a node docs/verification/issue-167/dev.mjs`.
6. Restore the exact saved native binary. Compare bytes and SHA-256 before running Node SQLite tests.

The real PDF used here is Attention Is All You Need, arXiv:1706.03762. [Results](live-results.json) record PDF size, extracted markdown length, and both SHA-256 hashes. Both scripts use unique temporary data/profile/config/cache directories and intercept adapter executables with exit-only stubs. No personal settings, credentials, model requests, or real account state are used. Temporary test state is retained at the paths printed in the logs.

The built harness creates a disposable `out/main/issue167.cjs` from the compiled application. Its startup seeds one real paper plus a note and historical user message through existing storage routines/SQL, without invoking ACP. It deletes the disposable entry on exit. Collection create, rename, delete, selection, navigation, and confirmation use visible Electron controls and typing. Membership setup uses the existing typed preload method. Preservation checks use typed read methods and exact file hashes.

For reply control, the harness retains the existing `vellum:collections-tree` handler, replaces its registration in isolated Electron, and queues a label/outcome for selected calls. A held success captures the real handler's result at request time and resolves only when released. A held failure rejects without changing storage. Non-held calls use the original handler. This uses Electron 32's private `_invokeHandlers` map solely in verification, as confirmed in [Electron v32.3.3 source](https://github.com/electron/electron/blob/v32.3.3/lib/browser/ipc-main-impl.ts). The production component and preload are not replaced. Future Electron versions may require adapting this test-only wrapper.

## Observed live results

[Built run](live.txt), [development run](dev.txt), and the reproducible [built harness](live.mjs) / [development harness](dev.mjs) capture these checks:

- Empty tree; New Collection autofocus; Escape cancel.
- Old initial success resolves while a newer poll remains pending. Loading stays visible until the newer request fails; its useful error appears, then the next successful poll recovers.
- Create through input/Enter while older initial request remains held. Both obsolete success and obsolete rejection preserve the new row and selected state.
- Rename through focused input/Enter survives an old successful poll. A newer poll also supersedes a held mutation-reload rejection.
- Current poll failure remains visible when an older successful poll resolves. A successful poll clears it.
- Chats unmounts the tree; held rejection released while unmounted does not affect the remounted Files tree.
- Real-paper membership filters Library to Attention Is All You Need; existing direct count shows 1. This does not change or validate the separate #120 count contract.
- Restart preserves collection, membership, paper, note, history preview, PDF hash, and markdown hash.
- Delete through visible confirmation survives an obsolete successful poll and preserves paper/note/history/files.
- Actual `npm run dev` Electron launch verifies keyboard activation of New Collection, input focus, Tab to Add, Enter submit, rename, delete, and empty state. Inspected button names and input placeholders used by the harness remain available. This is focused form accessibility evidence, not a full accessibility audit.

Screenshots: [empty](empty.png), [loading](loading.png), [obsolete success](old-initial-success.png), [obsolete rejection](old-initial-error.png), [current error](current-error.png), [real-paper membership](membership.png), [restart](restart.png), [delete](delete.png), [development keyboard](dev-keyboard.png).

[Built renderer console](renderer-console.txt) contains no messages, errors, or warnings. [Development renderer console](dev-renderer.txt) contains Vite connection and React DevTools information, no captured errors or warnings. Listeners attach after obtaining the first window, so these assertions cover the exercised journey rather than every startup message. [Built main log](main-console.txt) retains expected injected handler errors and Xvfb GPU initialization/DBus diagnostics. [Development main log](dev-main.txt) also records GPU/DBus diagnostics and a zygote termination diagnostic during shutdown. These logs are not claimed clean.

## Review and limits

Inline self-review against AGENTS/CLAUDE and #167 found no blocking standards or specification issues. No subagents, independent review, merge, watch, parent changes, or phase unlock. Scope is CollectionsTree, its colocated tests, and this issue's evidence. No generic request framework, backend/schema change, feature expansion, or visual redesign.

Reply ordering is controlled injection around real production SQLite responses. Natural IPC race incidence remains unverified. Real-paper content was seeded/extracted for membership and preservation checks; ingest and reader rendering were not retested. History is a seeded historical message, not a signed-in ACP conversation. ACP support and model behavior are unverified. Independent maintainer review remains required; PR stays draft.
