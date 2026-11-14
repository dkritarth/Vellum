# Issue #171 verification

Successful collection deletion clears the Library filter when the latest selected ID belongs to the deleted subtree. IDs are captured from the rendered tree before deletion, so polling can remove rows before the delete acknowledgement without losing descendant identity. Selection and callback come from the latest committed props. Failure and cancellation do not clear selection. Existing refresh publication ownership, error feedback, create/rename behavior, counts, IPC, backend and schema remain unchanged.

Exact base: [#168](https://github.com/dkritarth/Vellum/pull/168), `fix/collections-refresh-ownership`, `d1b359957b02c49355132fdfb070212278631197`, above [#115](https://github.com/dkritarth/Vellum/pull/115) and [#113](https://github.com/dkritarth/Vellum/pull/113). [#171](https://github.com/dkritarth/Vellum/issues/171) was already claimed and labeled `status:in-progress`. [Implementation plan](https://github.com/dkritarth/Vellum/issues/171#issuecomment-6688749620).

## Automated evidence

- [Red](red.txt), recorded before production edits: 5 fail, 21 pass. Selected child/deep descendant survives real SQLite recursive deletion; captured parent selection wrongly clears a newly selected unrelated collection; newly selected deep descendant survives deletion; successful retry retains deleted descendant filter. Derived from supplied `/tmp/vellum-collection-descendant-repro/repro.test.tsx` and `result.log`.
- [Focused](focused.txt): 26 pass, including real in-memory storage with rendered public controls and controlled pending deletion. Direct/unrelated selection, child/deep descendants, switches to unrelated/descendant/all papers, failure/retry and cancellation covered. All existing #168 refresh-ordering and #113/#115 feedback tests pass.
- [Full suite](tests.txt): 41 files, 403 tests pass. Existing tests deliberately log mutation failures.
- [Typecheck](typecheck.txt), [build](build.txt), and `git diff --check` pass.
- [Native restore](native-restored.txt): Node binary SHA-256 before and after matches; `cmp` passed, and Node opened/query/closed an in-memory database after exact restoration. No Node tests overlapped Electron rebuild or runs. Dependencies installed only in this checkout; no parent native binary modified.

## Reproduce live verification

Run from this checkout, with dependencies installed and a real Attention Is All You Need PDF, arXiv:1706.03762:

1. Run `npm run build`.
2. Back up `node_modules/better-sqlite3/build/Release/better_sqlite3.node` outside the checkout. Record SHA-256.
3. Run `npx electron-rebuild --force --only better-sqlite3`. Do not run Node SQLite tests until restoration.
4. Run `xvfb-run -a node docs/verification/issue-171/live.mjs /absolute/path/to/attention.pdf`.
5. Run `xvfb-run -a node docs/verification/issue-171/dev.mjs`.
6. Restore the exact original native binary. Compare bytes with `cmp`, check SHA-256 and run an in-memory Node query.

[Built harness](live.mjs) adapts #168's harness. It copies compiled main to disposable `out/main/issue171.cjs`, seeds a real paper with extracted markdown, one note and one historical user message through existing storage, and removes the disposable entry on exit. Every run gets unique data/profile/config/cache directories. Exit-only adapter stubs prevent model calls. Personal credentials, settings and sessions are unused. Membership setup uses existing typed `collectionsAssign`; create, select, navigation, delete confirmation and keyboard interactions use visible controls. Assertions inspect rendered state, typed public reads, and exact PDF/markdown hashes.

For controlled pending/failure cases, the isolated main process retains the production `vellum:collections-delete` handler using Electron 32's private `_invokeHandlers` map. Normal calls use the original handler. `before` delays invoking the original until explicitly released. `after` invokes real deletion first, delays acknowledgement, and waits for polling to remove the visible subtree. `fail` throws a named error without invoking deletion. Renderer API and production source are not replaced. This repeats the private-map technique documented by #168 against [Electron v32.3.3 source](https://github.com/electron/electron/blob/v32.3.3/lib/browser/ipc-main-impl.ts); future versions may require harness changes.

The initial harness run exposed membership setup timing: assigning membership after selecting the same deep ID does not itself request Library refresh. Final harness explicitly selects All Papers after membership setup, then selects the target through visible controls. Final evidence comes from a fresh isolated run.

## Observed live results

[Built results](live.txt), [structured results and hashes](live-results.json), and [development results](dev.txt):

- Empty state; keyboard activation of New Collection; autofocus and Escape cancellation.
- Visible parent/child/deep creation through input, Tab to Add and Enter. Child and deep selections show the real paper. Cancelled ancestor confirmation retains subtree/filter; accepted deletion returns valid All Papers with the same paper.
- Deleting another subtree preserves unrelated selected collection and its real-paper results.
- Held delete: selected parent switches to unrelated collection and survives completion. Initially unrelated selection switches into the deleted deep descendant and clears on completion. Switching to All Papers stays there.
- Real deletion completes before acknowledgement; polling removes the subtree first. Acknowledgement still clears selected deep ID from captured subtree.
- Controlled failure retains subtree, descendant filter, paper and useful error. Retry clears error/filter only after success.
- Direct selected deletion still clears. New Collection remains focusable after deletion; no automatic focus-restoration claim.
- Full close/relaunch preserves unrelated collection and membership, paper, note, history preview and exact file hashes. Unrelated filter works when selected again. Selection itself is not claimed persisted.
- Actual `npm run dev` verifies keyboard create/autofocus/Tab/Enter, rename/delete and empty state in another isolated profile. Focused keyboard/control labels checked; no full accessibility audit.

Screenshots: [empty](empty.png), [child before](child-before.png) / [after](child-after.png), [deep before](deep-before.png) / [after](deep-after.png), [switch out](switch-out.png), [switch in](switch-in.png), [all papers switch](switch-all.png), [delayed acknowledgement](ack.png), [failure retained](failure-retained.png), [restart](restart.png), [development keyboard](dev-keyboard.png). Deep before/after screenshots visually inspected.

[Built renderer log](renderer-console.txt) contains exactly one expected `Failed to delete collection` error from controlled failure. No other captured errors, warnings or page exceptions. [Development renderer log](dev-renderer.txt) contains Vite/React DevTools information and no captured errors/warnings. Listeners attach after first-window acquisition; claims cover exercised journeys, not every startup message. [Built main log](main-console.txt) includes injected IPC failure and Xvfb GPU/DBus diagnostics. [Development main log](dev-main.txt) includes GPU/DBus and shutdown zygote diagnostics. Main logs are not claimed clean.

## Self-review and limits

Standards review against AGENTS/CLAUDE and the exact base: no blocking finding. Production diff is one local committed-selection reference plus subtree capture in delete. Renderer isolation and typed allowlist unchanged. New tests import storage only in the test file and introduce no `any`. Existing refresh ownership remains untouched.

Specification review against #171: all listed local automated/live acceptance conditions exercised. Scope is CollectionsTree, colocated tests and issue evidence only. No backend/schema/framework, parent edits, subagents, merge, watch or phase unlock. Independent maintainer review remains pending; PR stays draft.

Pending timing and failure are injected around real storage/IPC. Natural race incidence and physical disk failure are unverified. Membership and preservation use seeded paper/note/history; ingest, reader rendering and signed-in ACP were not retested. No model call or Codex support claim. Initial membership timing is a harness setup constraint, not a new production change. No follow-up defect identified within scope.
