# Daily research workflow verification

Verified on dminer2, Linux x86-64, using Electron 32.3.3 and two real papers: Attention Is All You Need and Language Models are Few-Shot Learners. Product code froze at `f60be83`. Recorded source commit: `06f64dfc81ffc022d032fbd8475305d68992473f`. The recording began with a clean checkout; build hashes are in the evidence manifest.

## Fixes

- Details reports failed or missing metadata and offers Retry. A late response from a previous paper cannot replace the current paper.
- Collection assignment/removal failures show readable alerts and preserve the paper card. Successful retries clear the alert.
- Library stops requesting old collection tags after a new search replaces those results.
- Opening a conversation for a trashed paper explains that the paper must be restored. Restore makes the conversation accessible again.
- Incomplete context telemetry uses the same unavailable styling as other missing metrics.
- The legacy arXiv purge check now uses isolated data instead of the developer's real library.

## Automated and live checks

- Unit suite: 60 files, 979 tests pass.
- Typecheck and production build pass.
- Full offline Electron suite passes, including new metadata and collection/Trash recovery gates.
- Real-paper reader alignment gate passes at 100% and 125%, on multiple pages and after restart. Pointer selection aligns with raster ink.
- Reader scroll/zoom gate passes through all 15 pages. It verifies lazy rendering, pinch anchoring, keyboard zoom, horizontal scroll, search, page-three selection, and tab-state restoration.
- Notes race gate passes delayed saves/clears, paper isolation, failure recovery, keyboard focus, and restart persistence.
- Chats, suggested questions, collections, Trash, Usage, and app UX gates pass.
- Real arXiv dotted-slug purge passes against isolated SQLite and files.
- Signed-in Codex smoke returns exactly `pong` with successful completion. Recorded Ask/Explain and Quick actions use the real adapter.
- Diff and script syntax checks pass.

New error gates control only a failed metadata reply and two failed collection writes. Their successful retries use the production handlers. They do not mock successful persistence or ACP responses. Passing renderer logs contain no errors, warnings, or uncaught exceptions.

Separate standards and spec reviewers found no blockers. The standards reviewer independently repeated both real-paper recovery gates and inspected six error/recovery screenshots.

## Audit dispositions

Gemini's source audit supplied candidate defects. Parent reproduced collection errors, cancelled tag requests, and trashed-paper chat navigation with failing regression tests before fixing them. The partial-context styling discrepancy was corrected.

Chat search deliberately hides obsolete results while a new query loads. The audit's claimed input-focus loss was not established, so this behavior remains unchanged. Re-ingest date semantics and collection deletion outside the app remain design questions, not certified bugs or newly implemented features.

## Limits

This verifies the existing core research workflow on Linux. It does not certify macOS/Windows packaging, physical trackpad hardware, or every possible paper and network condition.

Codex is the verified signed-in backend. An exploratory Claude turn encountered a provider rate limit. Gemini application answers were not certified. The separate Opus audit could not run because its Antigravity quota was exhausted.

Workspace switching and slash/context pickers remain explicit coming-soon features. Their blocked milestones were not unlocked. Outline behavior depends on the PDF's embedded outline; citations require resolvable numbered references. No Zotero, cross-paper synthesis, or writing workspace implementation is claimed.

No worktrees were created. One clean obsolete worktree was removed after confirming remote commit reachability; its wiki files were preserved in a 52 KB archive. The remaining old worktree contains 26 uncommitted test lines and was preserved.

## Recordings and timestamps

Both original WebM segments are uncut. The second segment starts a new Electron process using the first process's isolated state.

- [Part 1: daily research workflow](../evidence/daily-workflow-2026-11-16/walkthrough-1.webm)
- [Part 2: restart, deletion, clear, and purge](../evidence/daily-workflow-2026-11-16/walkthrough-2.webm)
- [Passed chapter checklist, source/build provenance, and video hashes](../evidence/daily-workflow-2026-11-16/result.json)
- [Details error](../evidence/daily-workflow-2026-11-16/details-error.png) and [successful Retry](../evidence/daily-workflow-2026-11-16/details-recovered.png)
- [Collection error](../evidence/daily-workflow-2026-11-16/collection-error.png)
- [Trashed conversation blocked](../evidence/daily-workflow-2026-11-16/trashed-chat-blocked.png) and [restored conversation](../evidence/daily-workflow-2026-11-16/restored-chat.png)

| Video | Start | Verified chapter |
| --- | --- | --- |
| 1 | 0:01 | Empty workspace and deferred features |
| 1 | 0:08 | Import error and clean retry dialog |
| 1 | 0:12 | Import real paper 1 through Add Paper |
| 1 | 0:20 | Import real paper 2 through Add Paper |
| 1 | 0:29 | Reader continuous scroll, navigation, and outline |
| 1 | 0:34 | Pinch zoom and reader keyboard shortcuts |
| 1 | 0:39 | Document search matches, navigation, and empty results |
| 1 | 0:46 | Citation hover and reference navigation |
| 1 | 0:51 | Model selection, mouse selection, and Add to chat |
| 1 | 1:02 | Selection Explain with signed-in Codex |
| 1 | 1:22 | Suggested questions refresh and send |
| 1 | 1:35 | Quick action: Breakdown |
| 1 | 2:05 | Quick action: Practice questions |
| 1 | 2:23 | Quick action: Study guide |
| 1 | 2:39 | Context-menu highlight and annotation navigation |
| 1 | 2:44 | Highlight tool, color selection, and deletion |
| 1 | 2:51 | Notes autosave and paper isolation |
| 1 | 2:56 | Stored paper details |
| 1 | 2:58 | Tab close, Library shortcut, and reopen |
| 1 | 3:01 | Panel resizing, collapse, restore, and keyboard focus |
| 1 | 3:06 | Library search, sort, and collection assignment |
| 1 | 3:15 | Trash, restore, and purge confirmation cancellation |
| 1 | 3:22 | Authentic usage telemetry and refresh |
| 1 | 3:24 | Chat library search and session reopening |
| 2 | 0:01 | Restart restores library, notes, annotations, and conversation |
| 2 | 0:06 | New chat and isolated conversation deletion |
| 2 | 0:11 | Clear note, delete collection, and permanently purge isolated paper |
