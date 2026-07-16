# HANDOFF

Snapshot for resuming work later. Read this first, then PLAN.md/AGENTS.md/NOTES.md.

## Status as of this handoff

- **M0** (arXiv ingest -> markdown -> section extraction) — done, merged, on `master`.
- **M1** (DOI/URL/local-file inputs, Claude-CLI extraction, paper-qa Q&A) — done, merged, on `master`. paper-qa Q&A blocked without `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` — documented in NOTES.md, not fixed.
- **M2** (cross-paper synthesis, `scripts/synthesize.py`, `--contradictions` mode) — done, merged, on `master`. Verified against real papers.
- **M3** (citation graph) — **done, merged, pushed to `master`** (merge commit `31783c2`). `scripts/citations.py` (build + report subcommands), `papers/*/citations.yaml` for all 5 papers (in-corpus reference matching + Semantic Scholar external citing-papers lookups), `citations/report.md` (most-cited ranking, adjacency listing, connected-component clusters). Verified by a fresh agent against real paper text before merge (see below) — PASS-WITH-CONCERNS, no blocking bugs.
  - Known latent concerns (not bugs, not fixed): the Claude-CLI reference-parsing step is not perfectly deterministic run-to-run (~10% variance in `references_parsed` count observed on a repeat run); `semantic_scholar.lookup_status: ok` doesn't distinguish a genuinely-zero-citations paper from an empty `cited_by_external` list; the 0.55 Jaccard title-matching threshold is untested at corpus sizes beyond 5 papers.
  - Worktree `worktree-agent-a7643537dae1fb5ef` and its local branch have been removed (content preserved via merge commit); the branch still exists on `origin` if needed.

`master` is clean, pushed, matches `origin/master` (commit `31783c2`).

## Suggested next steps (not started)

- Stress-test with 5-10 more real papers, varied venues/formats (would also exercise the title-matching-at-scale concern above).
- Add a regression script that re-runs ingest/synthesize/citations against the existing corpus and diffs output sensibly, so future changes self-verify without a human.
- If reference-parsing determinism becomes a real problem at larger scale, consider pinning `claude -p` temperature/sampling or adding a lightweight self-consistency check.

## Standing conventions for this project (established this session)

- **Build-then-verify, always.** No merge to `master` without a separate agent actually running the new/changed scripts against real data (not synthetic fixtures) and confirming output is sensible — not just "didn't crash."
- **Delegation sizing**: `caveman:cavecrew-investigator` for locate-only lookups, `caveman:cavecrew-builder` for surgical <=2-file fixes with obvious scope, full `claude` background agent (worktree-isolated) for multi-file builds/new features. cavecrew-builder hard-refuses 3+ file scope — don't force it.
- **AGENTS.md guardrails still apply**: no SQLite/Postgres/vector store, no custom RAG, plain files only, don't start scope beyond what's asked.
- **Autonomous mode**: user does not want to be asked for scope go-aheads or routine check-ins during a work session — proceed on sensible judgment, only interrupt for genuinely critical/blocking issues.
- Caveman ultra mode was active for this session's agent chatter (token-saving); not a hard requirement for future sessions unless re-invoked.

## Other things built this session (outside local-anara's own scope, but related)

- **Global token/cost tracker**: `~/.claude/scripts/token_tracker.py` — scans all `~/.claude/projects/**/*.jsonl` transcripts (every project, every subagent/worktree session on the machine), prices tokens per Anthropic's live rates, writes incrementally to `~/.claude/usage/{usage.jsonl,summary.json,state.json}`. Note: this file was edited outside this session (a message_id-based dedup fix was added to `scan()` — the version on disk now differs from what was originally written; don't blindly revert it).
- **local-anara's thin wrapper**: `scripts/usage.sh` — filters the global tracker's report to this project's sessions. Documented in `CLAUDE.md`.
- **GitHub repo**: public at https://github.com/dkritarth/local-anara — description/topics set, wiki populated (Home/Getting Started/Architecture pages), README reflects real M0-M2 status.

## Known limitations (see NOTES.md for full detail)

- paper-qa Q&A (`scripts/ask.py`) needs a raw `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env — not available in this environment, not worked around.
- Section-extraction and synthesis both shell out to the `claude` CLI (`claude -p --output-format json --tools ""`) rather than calling the Anthropic API directly — this is intentional (reuses existing credentials, no raw key needed) but means both are unavailable if the `claude` binary isn't on PATH.
- Corpus is small (5 real papers) — extraction/synthesis/citation-matching haven't been stress-tested at larger scale yet.

