# HANDOFF

Snapshot for resuming work later. Read this first, then PLAN.md/AGENTS.md/NOTES.md.

## Status as of this handoff

- **M0-M3** (ingest, extraction, cross-paper synthesis, citation graph) —
  done, merged, on `master`. See prior handoff history in git log
  (`c6a5cf6`, `31783c2`, `8b301aa`) for that detail — not repeated here.
- **Phase 4** (local web interface + model selection + LaTeX synthesis +
  Agent SDK chat) — **all 5 workstreams done, merged, pushed to `master`**
  (commit `2e40402`). Scope/rationale in `PLAN.md`'s "Phase 4" section.
  1. **Explicit per-call model selection** (`a44b160`) — `--model` is now a
     required flag (no default) on `ingest.py`/`synthesize.py`/
     `citations.py build`; each script records which model was used in its
     output file (`metadata.yaml`/synthesis frontmatter/`citations.yaml`).
  2. **Browse-only web UI** (`f353029`) — `webapp/` FastAPI app, read-only
     views over `papers/`/`synthesis/`/`citations/` on disk, no database.
  3. **LaTeX-compiled synthesis** (`ecd10bb`) — `scripts/latex_synthesis.py`
     compiles a `synthesize.py` output file to a thesis-chapter-style PDF
     via `tectonic`, with a generated `.bib` per cited paper and numeric
     `\cite{}` substitution. Scoped to synthesis output only; ingested-paper
     notes stay markdown.
  4. **Web UI actions** (`ecd10bb`) — `/actions` routes trigger
     ingest/synthesize/citations-build from the browser, shelling out to
     the existing scripts (argv-list `subprocess.run`, never `shell=True`).
  5. **Chat/Q&A via Claude Agent SDK** (`2e40402`) — `/chat` route, backed
     by `claude_agent_sdk` (not the `claude -p` CLI-shelling pattern the
     other scripts use — this was the one deliberate exception, see
     `PLAN.md`). Supports per-paper Q&A and corpus-overview Q&A. Model
     field required on every call, same no-auto-tiering rule as the rest of
     Phase 4. Chat transcripts are **in-memory only** — lost on web process
     restart, no persistence layer (deliberate first-cut scope choice, not
     an oversight).

`master` is clean, pushed, matches `origin/master` (commit `2e40402`).

## Known limitations / not yet done

- **Chat has no persistence** — by design for this first cut, but worth
  revisiting if real usage makes losing transcripts on restart annoying.
  If picked up later: keep it plain-files (e.g. one file per conversation
  under a new `chats/` dir), consistent with the rest of the project's
  no-DB convention — don't reach for SQLite/Postgres.
- **No test suite** for any of Phase 4 (web UI, LaTeX compile, chat) —
  validated so far by manually running the app and hitting real routes/
  forms against real corpus data, not automated. Same "test against real
  data, not fixtures" bar as the rest of the project (see `AGENTS.md`).
- **Corpus is still small** (5-6 real/test papers under `papers/`) — Phase 4
  UI/chat/LaTeX paths haven't been stress-tested at a larger corpus size.
- Pre-existing M0-M3 limitations (paper-qa needs a raw API key for
  `scripts/ask.py`; `claude` CLI must be on PATH for ingest/synthesize/
  citations-build; reference-parsing has ~10% run-to-run variance) are
  unchanged — see `NOTES.md` for full detail, not repeated here.

## Suggested next steps (not started)

- Decide whether chat needs persistence (see above) based on actual usage,
  not speculatively ahead of a real need.
- Stress-test the full Phase 4 stack (browse UI, actions, LaTeX compile,
  chat) against a larger, messier real corpus — the current papers/ are
  mostly synthetic test fixtures, not a real reading list (see the earlier
  same-day handoff in `/tmp` for that caveat, if still present on disk).
- Consider auth for the web UI only if it's ever exposed beyond localhost —
  currently unauthenticated by design (personal local single-user tool).
- Add a regression script that re-runs ingest/synthesize/citations against
  the existing corpus and diffs output sensibly (carried over from the M3
  handoff — still not done).

## Standing conventions for this project

- **Build-then-verify, always.** Don't merge/report done without actually
  running the new/changed code against real data and confirming sensible
  output — not just "didn't crash."
- **AGENTS.md guardrails still apply**: no SQLite/Postgres/vector store, no
  custom RAG, plain files only, don't start scope beyond what's asked.
- **`AGENTS.md`'s "Required skills for agents/subagents"** section (added
  during Phase 4) mandates `caveman`, `academic-humanizer`, and
  `research-paper-writing` skill usage where applicable for any
  agent/subagent working in this repo — read it before spawning subagents.
- Caveman mode is this user's standing preference for agent/assistant
  chatter in this project (token efficiency) — code, commits, and PR text
  are still written normal.

## Other things built alongside this project (outside local-anara's own scope)

- **Global token/cost tracker**: `~/.claude/scripts/token_tracker.py` —
  scans all `~/.claude/projects/**/*.jsonl` transcripts machine-wide, prices
  tokens per Anthropic's live rates, writes incrementally to
  `~/.claude/usage/{usage.jsonl,summary.json,state.json}`.
- **local-anara's thin wrapper**: `scripts/usage.sh` — filters the global
  tracker's report to this project's sessions; refreshed incrementally
  before each report. Documented in `CLAUDE.md`.
- **GitHub repo**: public at https://github.com/dkritarth/local-anara.
