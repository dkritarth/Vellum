# Beta runtime verification

Verified on dminer2, Linux x86-64, after the release dependency audit. Electron 45.3.3, PDF.js 6.2.108, better-sqlite3 13.2.0, transitive Zod 4.6.7, and electron-builder 26.18.0 are pinned by the release lockfile.

## Automated checks

- Unit suite: 62 files, 984 tests pass.
- Typecheck and production build pass.
- All offline Electron gates pass, including metadata retry, collection errors, Trash/chat boundaries, real PDF canvas/text layers, and restart persistence.
- Release metadata and website CLI regression tests: five pass. Website staging succeeds with both original recording assets.
- `git diff --check` and walkthrough script syntax checks pass.
- Production dependency audit reports zero advisories. The full audit has 13 development dependency entries, including two critical parent/transitive test-tool entries. Electron was audited separately because its development dependency classification does not mean it is absent from the shipped app. Remaining work is tracked in [#226](https://github.com/dkritarth/Vellum/issues/226).

## Real-paper signed-in walkthrough

All 27 chapters pass against the actual Electron app using Attention Is All You Need and BERT. The recorded source was clean at `6e5e5a4707476bba31b70bc67505559ca56ea2ba`; [manifest](../evidence/beta-release/runtime-result.json) includes build hashes and chapter timestamps.

The run covers ingestion error/retry, two real-paper imports, continuous scrolling, zoom, search, reference navigation, mouse selection, Add to chat, signed-in Codex Explain, suggested questions, Breakdown, Practice questions, Study guide, highlights, notes, details, panels, Library collections, Trash/restore, usage, and conversations. A second Electron process restores the library, saved note, highlight, and grounded Codex conversation. [Restart screenshot](../evidence/beta-release/runtime-restart.png).

Renderer console has no errors or warnings. No successful storage or ACP replies were stubbed. Original public walkthrough videos remain in the [daily workflow report](daily-workflow-2026-11-16.md); this rerun verifies the later dependency changes without duplicating tracked video blobs.

An obsolete delegated audit automatically resumed and switched the shared checkout during an earlier run. Its automatic stash preserved the release changes; those changes were recovered and committed before this clean-source run. That interrupted result is excluded. A separate failing retry-dialog check exposed a walkthrough timing race: keyboard dispatch completed before React unmounted the old modal. The harness now waits for the dialog to detach before reopening it. The final run passes that transition.

## Review and platform limits

Separate standards and spec reviewers found no actionable blockers in the runtime dependency and native packaging changes. Parent reviewed the diff, lockfile, native source hash, and visible restart screenshot. The Linux native resource matches the pinned npm prebuild byte for byte. A copy of an earlier isolated test database passes SQLite integrity checking with the updated library; no personal library was used.

New-source Mac packaged smoke remains required in PR checks before merge. Linux evidence does not certify physical Mac trackpad behavior or signed-in Mac ACP sessions. Package and download metadata now require macOS 13 or later, matching Electron's supported minimum. MIT remains unchanged; the only Mac target is arm64.
