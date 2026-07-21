# AGENTS.md

Conventions and guardrails for AI agents building Vellum. Read `PLAN.md` and
`CLAUDE.md` first.

## Caveman mode

Operate in **caveman full** (`.claude/skills/caveman/`) for all prose: terse,
drop articles/filler/pleasantries/hedging, technical terms exact. Write
**normally** for: code, commit messages, PR titles/bodies, security warnings,
irreversible-action confirmations, and any multi-step sequence where dropped
conjunctions could reorder meaning.

## How to pick up work

1. The **GitHub wiki** is the backlog. Open the current phase page
   (`Phase-1-MVP` first), pick an unclaimed task card.
2. Read its **scope · files · acceptance criteria**.
3. Build it **test-first** (use the `tdd` skill). For design decisions use
   `codebase-design` and `domain-modeling`; to investigate ACP/Electron APIs use
   `research`; to de-risk an unknown use `prototype`.
4. Open a **PR against `master`**, link the wiki card, list acceptance criteria met.
5. Self-review with the `code-review` skill before requesting review.

## Coding conventions

- TypeScript strict. No `any` unless justified in a comment.
- Renderer never imports Node/Electron directly — only `window.vellum` (preload).
- Backend logic lives in `core/` (main-process side), imported by `electron/`.
- Small, deep modules (`codebase-design` skill). One clear seam per feature.
- Tests: `vitest`, colocated `*.test.ts`. Every task card ships with tests.

## Hard guardrails (do not violate)

- **ACP only, first-party only.** Spawn `claude-code-acp` / `codex-acp`. Never
  bridge subscription OAuth into a third-party harness — banned + blocked.
- **No raw API key path** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). Auth comes
  from the signed-in CLIs.
- **No Python.** Pure Node/TS.
- **No custom RAG / embeddings.** Grounding = agent-native file tools over
  `data/papers/<slug>/`. Revisit only on a proven large-corpus wall.
- **Storage split:** SQLite for state, files for content. Do not put paper
  markdown in the DB (the agent reads files).
- **Start empty.** Do not re-add the old CLI corpus; it lives in
  `archive/cli-prototype`.

## Scope discipline

MVP = the Phase-1 vertical loop only. Shell shows every anara button, but only
the Phase-1 subset is wired; the rest render as visible "coming soon" stubs.
Don't pull Phase-2/3 work forward without a card saying so.

## Storage / files layout

- Paper content: `data/papers/<slug>/paper.pdf`, `paper.md` (gitignored).
- App state: `data/app.db` (SQLite; schema in `core/store/schema.ts`, grown via
  numbered migrations).

## Testing against real papers

Validate ingest against real arXiv IDs / DOIs / local PDFs, not just fixtures.
Spot-check extracted sections/metadata against the rendered PDF.
