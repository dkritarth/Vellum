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

Scoped. This is a workflow layer on top of existing open-source tooling
(paper-qa, markitdown, Anthropic skills) — not a from-scratch Anara clone.
MVP is paper ingest + section extraction, storing one plain-file directory
per paper (no database). Cross-paper synthesis and a citation graph are
later phases.

See [`PLAN.md`](./PLAN.md) for the full concept, rationale, roadmap, and
success criteria. See [`AGENTS.md`](./AGENTS.md) and
[`CLAUDE.md`](./CLAUDE.md) for AI-agent working conventions.
