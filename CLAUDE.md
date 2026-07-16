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

One-time setup (local virtualenv — do not install markitdown/requests/pyyaml/
paper-qa into global Python; `markitdown` via pipx is not importable from
scripts):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install paper-qa   # needed for scripts/ask.py; not in requirements.txt
                        # since it pulls a heavy dependency tree — install
                        # it only if you're using Q&A.
```

Ingest a paper end-to-end (download/read -> markdown -> section extraction
-> `papers/<slug>/`). Accepts an arXiv ID/URL, a DOI/doi.org URL, a direct
PDF URL, or a local PDF file path — auto-detected (see `classify_input()` in
`scripts/ingest.py`):

```bash
source .venv/bin/activate
python scripts/ingest.py 1706.03762
python scripts/ingest.py https://arxiv.org/abs/1706.03762   # arxiv URL
python scripts/ingest.py 10.18653/v1/N19-1423               # DOI
python scripts/ingest.py https://doi.org/10.18653/v1/N19-1423
python scripts/ingest.py https://example.org/some-paper.pdf # direct PDF URL
python scripts/ingest.py ~/Downloads/some-paper.pdf          # local file
# DOI with no open-access PDF: attach one you already have locally
python scripts/ingest.py 10.1371/journal.pone.0130140 --pdf ~/Downloads/paper.pdf
```

Output per paper: `papers/<slug>/paper.pdf`, `paper.md` (both omitted for a
metadata-only DOI entry with no PDF available), `metadata.yaml`
(input_type/title/authors/year/venue/abstract/doi/arxiv_id + section
boundaries + `extraction_method`).

Section extraction tries a Claude-driven pass first (shells out to the
`claude` CLI in non-interactive mode — `claude -p --output-format json
--tools ""` — using whatever credentials this environment already has, no
raw `ANTHROPIC_API_KEY` required), and transparently falls back to the M0
heuristic regex extractor if the `claude` binary isn't on PATH or the call
fails/times out/returns bad JSON. `metadata.yaml`'s `extraction_method`
field (`claude-cli` or `heuristic-regex`) records which one actually ran.
See `NOTES.md` for recall numbers and remaining known limitations of each
path — extraction always degrades gracefully (missing sections ->
`found: false`) rather than failing, per `AGENTS.md`'s "must tolerate
partial/missing sections" rule.

Ask a question against one already-ingested paper via paper-qa (single-paper
Q&A, no custom RAG — paper-qa handles retrieval):

```bash
source .venv/bin/activate
python scripts/ask.py 1706.03762 "What optimizer did they use?"
# or point at a papers/ subdirectory directly:
python scripts/ask.py papers/1810.04805 "How is NSP pre-training done?"
```

`scripts/ask.py` requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the
environment — paper-qa calls the provider API directly via LiteLLM (unlike
`ingest.py`'s Claude-CLI-based extraction, this can't reuse an existing
Claude Code session's credentials). See `NOTES.md` if you hit "No LLM API
key found."

Synthesize a lit-review-style paragraph across a folder of already-ingested
papers (M2 — cross-paper synthesis, reads `metadata.yaml` + `paper.md`
section slices, shells out to the `claude` CLI same as `ingest.py`'s
extraction pass, no raw API key required):

```bash
source .venv/bin/activate
# default: every paper under papers/
python scripts/synthesize.py "how do these papers handle attention/alignment mechanisms"
# restrict to specific paper ids/slugs
python scripts/synthesize.py "how is pretraining used?" 1810.04805 1706.03762
# contradiction/agreement-detection mode instead of a plain synthesis paragraph
python scripts/synthesize.py "is recurrence necessary for good performance" --contradictions
# print to stdout without writing a file
python scripts/synthesize.py "topic" --print-only
```

Output: `synthesis/<topic-slug>.md` (or `<topic-slug>-contradictions.md` in
`--contradictions` mode) — YAML frontmatter (`topic`, `mode`, `papers`
included, `citation_labels`, `generated_at`, `extraction_method`) followed
by the synthesized prose. Plain files, no database, consistent with
`papers/`'s convention; no SQLite/embeddings index was added since a plain
glob over 5 papers is effectively instant — see `NOTES.md` for the "only
add an index if you hit a real wall" rationale.

There is no heuristic fallback for synthesis (unlike `ingest.py`'s section
extraction): if the `claude` CLI is missing or fails, `synthesize.py` exits
non-zero with a clear error rather than writing a fabricated or low-quality
file. The "reuse `research-paper-writing` skill for the writing side" from
`PLAN.md` is implemented at the prompt level (the synthesis prompt mirrors
that skill's prose principles — topic-sentence-first paragraphs, explicit
claim-to-citation alignment, no flat "Paper A says X" listing) rather than
as a literal Skill-tool invocation — see `NOTES.md`'s M2 section for why
that skill can't be driven non-interactively from a plain script.

There is no test suite yet; validate by re-running `ingest.py` against a
few real arXiv IDs/DOIs/URLs and spot-checking `metadata.yaml` section
boundaries against `paper.md`, per `AGENTS.md`'s Testing section. Validate
`synthesize.py` similarly: re-run against real ingested papers and read the
generated `synthesis/*.md` prose for coherence and citation accuracy.

Token/cost usage for this project's Claude Code sessions and background
agents (including worktree-isolated agent sessions, since each gets its own
`~/.claude/projects/` transcript):

```bash
scripts/usage.sh --by model     # per model
scripts/usage.sh --by day       # per day
scripts/usage.sh --since 2026-07-01
```

This is a thin filter over the global tracker at
`~/.claude/scripts/token_tracker.py`, which scans every session transcript
on the machine (`~/.claude/projects/**/*.jsonl`), prices tokens per current
Anthropic API rates, and accumulates results incrementally into
`~/.claude/usage/{usage.jsonl,summary.json}` — not project-specific storage,
so it survives this repo being deleted/re-cloned.

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
