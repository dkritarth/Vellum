# Failed re-ingest preservation

Issue #140, stacked on PR #96 at `3a7145fc8a06225c8be463f42361168947b96729`.
No classifier, schema, UI, or ACP changes. #119 remains separate.

## Ownership and recovery

`ingest()` owns candidate staging and the final SQLite transaction.
Extraction and summary read candidate Markdown, while published content stays
unchanged. `publication.ts` owns replacement files and recoverable originals.
Each target gets a private sibling directory, so legacy paths stay unchanged
and rename does not cross filesystems. Both candidates are copied before any
original is moved. Non-file targets are rejected without deleting their data.

Final source resolution, legacy adoption, publication, metadata, and source
binding run synchronously inside one immediate transaction. No transaction spans
an `await`. The publication scope retains originals until COMMIT returns, including
failures raised at COMMIT rather than during statements. Same-process ingests
cannot interleave publication or rollback. Independent analysis can progress.
Concurrent legacy matches resolve ownership at final commit, not during staging.
Caller-owned transactions are rejected before work starts.

Handled copy, backup, publication, or database errors restore original files and
roll back metadata/bindings. Failed new imports remove published candidate files.
Cleanup errors after commit produce a warning with retained locations, not a false
failure result after successful replacement.

If restoration itself fails, the error says `recovery is incomplete` and reports
original-to-target paths. All replacement directories are retained. Other
restorations are still attempted. The error retains publication and recovery
causes. Some originals may already have moved back to their targets.

For manual recovery:

1. Stop Vellum and other writers. Preserve every reported recovery directory.
2. Inspect the reported original-to-target mappings. Restore remaining `original`
   files to their named targets after verifying that they are the prior content.
   An original already restored successfully no longer exists inside its directory.
3. Verify both published files against the unchanged database and research state
   before restarting or deleting retained directories.

No process-crash or power-loss atomicity, filesystem durability guarantee, startup
recovery, cross-process writer coordination, or concurrent external-file-reader
snapshot guarantee is implemented. Synchronous filesystem work briefly blocks the
main process during publication. Recovery failure requires manual repair.

## Automated evidence

Public `ingest()` tests use real PDFs, conversion, temporary files, and SQLite.
ACP is fake; targeted filesystem errors are injected at actual copy/rename/remove
calls. SQLite triggers inject update, source-binding, adoption, and deferred
foreign-key COMMIT failures.

Before the fix, the regression failed on original PDF byte comparison after DB
reopen. The row, note, highlights, chat, and collection assertions had passed.
After the fix, the same regression also passes retry with changed content and
stable identity/research. Additional tests cover partial publication, failed
restoration with recoverable original bytes, cleanup failure, new-import retry,
overlapping same-paper operations, independent progress, and legacy competition.

Commands:

```bash
npm test -- core/ingest/index.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Focused: 22 tests. Full suite: 393 tests across 41 files. Typecheck, build,
and whitespace check pass. Self-review covers standards and issue acceptance;
independent review remains pending.

## Live Electron evidence

2026-11-05: production build, Playwright Electron under xvfb, isolated data and
profile, adapters absent from PATH. Native SQLite rebuilt locally for Electron;
the original Node binding was backed up and restored. No signed-in ACP claim.

Through visible Create controls, imported the real Transformer paper, opened its
PDF, and typed a note. Installed an explicit SQLite BEFORE UPDATE abort trigger,
changed the same source path to the real affine Springer paper, and submitted
again. The error dialog displayed `issue140 injected storage failure`. PDF and
Markdown remained byte-identical; row and note remained unchanged after restart.
Removed the trigger, retried through Create, then restarted again. Changed content
persisted with the same slug and paths, one library row, and the original note.
No staging or backup directories remained on the successful paths.

Empty submit disabled, input focus and labels checked, loading/error states
visible, reader canvas rendered, saved note visible after restart. Renderer
errors/warnings: zero. Main log contains the intentional ingest SQLite error,
Playwright debugger notices, and host GPU/D-Bus initialization diagnostics.
Existing text-layer duplication/misalignment from #86 remains visible in the
reader screenshot. No reader-fidelity fix or complete product certification is
claimed. No live filesystem fault or signed-in agent analysis was exercised.

[Injected database failure](injected-db-failure.png) ·
[Successful retry and restart](retry-restart-note.png)

Local detailed logs and isolated state: `/tmp/vellum140-evidence/`.
