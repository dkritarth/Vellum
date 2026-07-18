# Local Anara (open-source research assistant)

Anara (formerly Unriddle AI) is a paid research-assistant app. This is an
open-source, Claude-native alternative focused on the literature-review
workflow layer, not a from-scratch clone of Anara's chat/RAG core.

## Core idea

- Ingest research papers (arXiv ID, DOI, PDF URL, or local file), identify
  key sections, extract structure into a consistent schema.
- Built for PhD-adjacent workflow — literature review acceleration.
- Reuses `markitdown-converter`, `pdf`-family skills, and
  `research-paper-writing` skill already available, plus paper-qa for
  single-paper Q&A, rather than rebuilding a RAG engine from scratch.
- ACP is used as one interface for driving the pipeline interactively; the
  underlying logic is protocol-independent.

## Status

**M0 and M1 are done and working.** Ingestion supports arXiv ID/URL, DOI,
direct PDF URL, and local file inputs, with a stable, additive
`metadata.yaml` schema. Section extraction is Claude-driven (shells out to
the `claude` CLI, no raw API key required) with a transparent fallback to a
heuristic regex extractor when the CLI isn't available or fails — see
`NOTES.md` for measured recall numbers on both paths. Single-paper Q&A is
wired up via paper-qa, but **is currently blocked in environments without
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`** — the wiring itself is verified
end-to-end short of the live API call.

**M2 (cross-paper synthesis) is done.** `scripts/synthesize.py` reads a
folder of already-ingested papers and drafts a cited lit-review paragraph
answering "what do these papers say about X" (Claude-CLI-driven, same
credential path as ingestion's extraction pass), plus a `--contradictions`
mode for agreement/disagreement detection. See `NOTES.md`'s M2 section for
test queries and output samples.

**M3 (citation graph) is done.** `scripts/citations.py` parses each paper's
References section (Claude-CLI-driven, no regex fallback — see the script's
module docstring), matches references against the rest of the local corpus
to build in-corpus citation edges, and does best-effort Semantic Scholar
lookups for external citing-papers data. `citations.py report` writes
`citations/report.md` — a most-cited-in-corpus ranking, adjacency listing,
and connected-component clusters. This closes out `PLAN.md`'s full 3-phase
roadmap; see `HANDOFF.md` for verification notes and known latent
limitations (parse non-determinism, external-lookup status edge cases).

Storage is one plain-file directory per paper (no database) — see
`PLAN.md` for the rationale.

## Development cost and token usage

Snapshot: **2026-07-18**. Claude and Codex usage are reported separately
because their local telemetry and billing units differ.

### Claude Code sessions

Includes the main project session plus worktree-isolated Claude agents. The
tracker prices usage using its configured Anthropic rates:

| Model | Uncached input | Output | Cache read | Cache creation | Messages | Cost (USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-sonnet-5 | 972 | 341,175 | 32,189,127 | 3,772,432 | 487 | $24.9412 |
| **Total** | **972** | **341,175** | **32,189,127** | **3,772,432** | **487** | **$24.9412** |

Cache reads/creation are shown separately from uncached input; do not add
those columns to `Uncached input` as if they were independent prompt text.
`scripts/usage.sh` now scans incrementally before reporting, so new Claude
sessions are included automatically and duplicate assistant message records
are ignored.

### Codex sessions

Codex stores per-thread token usage locally in `~/.codex/state_5.sqlite`.
For this repository, the current local record contains one GPT-5.6 Luna
thread:

| Model | Threads | Input tokens | Cached input | Output | Reasoning output | Total tokens | Cost (USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gpt-5.6-luna | 1 | 4,468,814 | 4,302,592 | 34,431 | 15,521 | 4,503,245 | $4.6754 |

Estimated from the supplied GPT-5.6 pricing: Luna input is `$1.00/M` and
output is `$6.00/M`. This snapshot uses `$4.4688` input cost plus `$0.2066`
output cost = **$4.6754**. Cached input is included at the input rate because
no separate cache rate was supplied. Reasoning output is already included in
the output-token count and is not charged twice.

Pricing reference:

| Model | Input / 1M tokens | Output / 1M tokens |
| --- | ---: | ---: |
| GPT-5.6 Sol | $5.00 | $30.00 |
| GPT-5.6 Terra | $2.50 | $15.00 |
| GPT-5.6 Luna | $1.00 | $6.00 |

Refresh Codex numbers from the local database with:

```bash
sqlite3 ~/.codex/state_5.sqlite \
  "SELECT model, COUNT(*), SUM(tokens_used) FROM threads WHERE cwd LIKE '%local-anara%' OR rollout_path LIKE '%local-anara%' GROUP BY model;"
```

Claude's raw project-filtered ledger is under
`~/.claude/usage/usage.jsonl`; Codex's session records remain local under
`~/.codex/`. Neither usage source is committed to this repository.

## Usage

One-time setup (uses a project-local virtualenv; see `CLAUDE.md` for why):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install paper-qa   # only needed for scripts/ask.py (Q&A)
```

Ingest a paper (arXiv ID/URL, DOI/doi.org URL, direct PDF URL, or local file
— auto-detected):

```bash
source .venv/bin/activate
python scripts/ingest.py 1706.03762
python scripts/ingest.py https://arxiv.org/abs/1706.03762
python scripts/ingest.py 10.18653/v1/N19-1423
python scripts/ingest.py https://doi.org/10.18653/v1/N19-1423
python scripts/ingest.py https://example.org/some-paper.pdf
python scripts/ingest.py ~/Downloads/some-paper.pdf
# paywalled DOI with no open-access PDF: attach one you already have
python scripts/ingest.py 10.1371/journal.pone.0130140 --pdf ~/Downloads/paper.pdf
```

This writes `papers/<slug>/paper.pdf`, `paper.md`, and `metadata.yaml`
(title/authors/year/venue/abstract/section boundaries/`extraction_method`).

Ask a question about an already-ingested paper (requires `ANTHROPIC_API_KEY`
or `OPENAI_API_KEY` in the environment):

```bash
source .venv/bin/activate
python scripts/ask.py 1706.03762 "What optimizer did they use?"
python scripts/ask.py papers/1810.04805 "How is NSP pre-training done?"
```

Synthesize a lit-review paragraph across ingested papers (no API key
required — same `claude` CLI path as ingestion):

```bash
source .venv/bin/activate
python scripts/synthesize.py "how do these papers handle attention/alignment mechanisms"
python scripts/synthesize.py "is recurrence necessary for good performance" --contradictions
```

This writes `synthesis/<topic-slug>.md` with the synthesized prose and a
frontmatter block noting which papers were included.

See `CLAUDE.md`'s Commands section for the full details, and `NOTES.md` for
known limitations of each path.

See [`PLAN.md`](./PLAN.md) for the full concept, rationale, roadmap, and
success criteria. See [`AGENTS.md`](./AGENTS.md) and
[`CLAUDE.md`](./CLAUDE.md) for AI-agent working conventions.
