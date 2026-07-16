# CLAUDE.md

Guidance for Claude Code when working in this project folder.

## What this project is

An open-source, Claude-native literature-review workflow tool: ingest a
paper (arXiv ID, DOI, PDF URL, or local file), extract its structure into a
consistent schema, and (in later phases) synthesize across papers and build
a citation graph. See `PLAN.md` for the full concept and rationale, and
`AGENTS.md` for coding conventions and guardrails. Read both before making
non-trivial changes here — this file is deliberately short.

## Relevant skills

Use these existing skills rather than reimplementing their functionality:

- `markitdown-converter` — PDF/Word/Excel to markdown conversion during
  ingestion.
- `pdf` (and related Anthropic pdf-family skills) — PDF handling.
- `research-paper-writing` — lit-review synthesis / writing assistance in
  Phase 2.

## Commands

One-time setup (local virtualenv — do not install markitdown/requests/pyyaml
into global Python; `markitdown` via pipx is not importable from scripts):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Ingest a single arXiv paper end-to-end (download PDF -> markdown ->
heuristic section extraction -> `papers/<arxiv-id>/`):

```bash
source .venv/bin/activate
python scripts/ingest.py 1706.03762
# or paste an arxiv.org URL directly:
python scripts/ingest.py https://arxiv.org/abs/1706.03762
```

Output per paper: `papers/<arxiv-id>/paper.pdf`, `paper.md`, `metadata.yaml`
(title/authors/year/venue/abstract + section boundaries). See `NOTES.md`
for known limitations of the current (heuristic, non-LLM) section
extractor — it degrades gracefully (missing sections -> `found: false`)
rather than failing, per `AGENTS.md`'s "must tolerate partial/missing
sections" rule, but recall varies a lot with PDF layout quality.

There is no test suite yet; validate by re-running `ingest.py` against a
few real arXiv IDs and spot-checking `metadata.yaml` section boundaries
against `paper.md`, per `AGENTS.md`'s Testing section.

## Structure

```
local-anara/
  README.md    - short summary, points here
  PLAN.md      - finalized concept, roadmap, decisions, success criteria
  AGENTS.md    - AI agent conventions and guardrails
  CLAUDE.md    - this file
  papers/      - one directory per ingested paper (plain files, no DB)
```

## Workflow

1. Check `PLAN.md`'s roadmap before adding scope — MVP is ingest + section
   extraction only; cross-paper synthesis and citation graph are later
   phases.
2. Check `AGENTS.md` for storage/reuse conventions before writing new
   ingestion, extraction, or storage code.
3. Do not touch files outside `/Users/kritarth/code/ideas/local-anara/`.
4. Test against real papers, not just fixtures — see the Testing section
   of `AGENTS.md`.
