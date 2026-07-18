# AGENTS.md

Instructions for AI coding agents working on local-anara.

## Purpose

local-anara is an open-source, Claude-native literature-review workflow
tool: paper ingestion (arXiv/DOI/URL/local PDF) -> section extraction ->
(later) cross-paper synthesis and citation graphs. It is explicitly **not**
a from-scratch RAG/Q&A engine — see `PLAN.md` for the full rationale. Read
`PLAN.md` before making any scope decisions.

## Conventions

- **Storage is plain files, not a database.** One directory per paper under
  `papers/<arxiv-id-or-slug>/`, containing the original PDF, converted
  markdown, and a metadata frontmatter block (YAML/JSON) with extracted
  section boundaries and key fields. Do not introduce SQLite/Postgres/a
  vector store without first re-reading the storage rationale in
  `PLAN.md` — this was a deliberate decision, not an oversight.
- **Reuse existing skills instead of rebuilding them.** PDF-to-markdown
  conversion goes through the `markitdown-converter` skill and Anthropic's
  `pdf` skill family. Lit-review writing/synthesis goes through the
  `research-paper-writing` skill. Single-paper Q&A should delegate to
  paper-qa (or direct Claude reading of converted markdown), not a custom
  RAG pipeline.
- **MVP first.** Current build target is Phase 1 only: ingest + section
  extraction. Do not start Phase 2 (cross-paper synthesis) or Phase 3
  (citation graph) work unless explicitly asked — check `PLAN.md`'s
  roadmap before adding scope.
- **Section extraction schema must degrade gracefully.** Real papers have
  missing/nonstandard sections (scanned PDFs, two-column layouts, unusual
  headers). Extraction code must tolerate partial results, not fail hard
  on the first malformed paper.
- **Keep the core logic protocol-independent.** ACP is one interface among
  several for driving this tool from Claude Code. Ingestion/extraction/
  synthesis logic should be callable as plain scripts/CLI, not hard-wired
  to ACP internals.

## Required skills for agents/subagents

Any Claude Code agent or subagent (main session, background/worktree
agents, delegated builders/reviewers) working in this repo must invoke
these skills where applicable, not reimplement their function inline:

- `caveman` — use caveman-compressed communication style for agent-to-agent
  and agent-to-user chatter in this project (token efficiency), per this
  session's established convention. Code, commits, and PR text are still
  written normal — caveman applies to conversational output only.
- `academic-humanizer` — use when editing or generating academic-register
  prose for this project (synthesis output, lit-review paragraphs, any
  user-facing written content derived from paper text). Do not hand-roll
  academic tone/register logic in scripts or prompts when this skill
  already covers it.
- `research-paper-writing` — use for lit-review synthesis/writing
  guidance. `scripts/synthesize.py` currently reuses this skill's
  principles at the prompt-engineering level only (see `NOTES.md`'s M2
  section for why direct interactive skill invocation isn't possible from
  a non-interactive script) — if a future feature runs a live/interactive
  agent session (e.g. the planned web UI's synthesis or chat flow), invoke
  the skill directly via the `Skill` tool instead of re-deriving its
  prompt-level restatement.

## Structure (expected)

```
local-anara/
  README.md         - short pointer/summary
  PLAN.md           - full concept, roadmap, decisions
  AGENTS.md         - this file
  CLAUDE.md         - Claude Code specific guidance
  papers/           - one directory per ingested paper
  scripts/ or src/  - ingestion, extraction, synthesis logic
```

Do not restructure this layout without updating PLAN.md/CLAUDE.md to match.

## Testing

- Validate ingestion/extraction against real papers pulled from the
  project owner's own reading list, not just synthetic fixtures — the
  success criteria in `PLAN.md` are about real lit-review usage.
- When changing the extraction schema, re-run it against a small fixed set
  of previously-ingested papers and check the diff is sensible before
  committing — schema drift silently corrupts existing `papers/` entries.
- Prefer testing the ingestion pipeline end-to-end (download -> markdown ->
  extracted sections on disk) over unit-testing internal helpers in
  isolation, since the whole point is the pipeline working on messy
  real-world PDFs.

## What not to do

- Do not build a custom RAG/embedding/vector-search engine — delegate to
  paper-qa or Claude-native reading.
- Do not add a database for storage without re-justifying it against the
  plain-files rationale in `PLAN.md`.
- Do not start citation-graph (Phase 3) work before Phase 1/2 are solid.
- Do not hard-couple the extraction/synthesis logic to ACP-specific APIs.
- Do not touch files outside this project folder
  (`/Users/kritarth/code/ideas/local-anara/`) as part of local-anara work.
