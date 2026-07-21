# CLAUDE.md

Guidance for Claude Code (and any agent) working in the **Vellum** repo.

## What this is

Vellum — a local-first, Electron desktop AI paper workspace styled after
anara.com, that runs on **your own** Claude/Codex plan via **ACP** (no extra API
subscription, no raw API key). Read `PLAN.md` for the concept and phases, and
`AGENTS.md` for conventions, guardrails, and how to pull work from the wiki.
This file is deliberately short.

## Caveman mode (ON by default)

All agents in this repo operate in **caveman full** — terse, drop
articles/filler/pleasantries/hedging, keep full technical accuracy. See
`.claude/skills/caveman/`. Write **normally** for code, commit messages, PR
bodies, security warnings, and irreversible-action confirmations. Disable with
"stop caveman" / "normal mode".

## Architecture (locked — see PLAN.md ledger)

- **Shell:** Electron. `electron/` = main + preload (Node); `src/` = React UI.
- **Language:** pure Node/TS. No Python anywhere.
- **AI seam:** one unified **ACP client** (`core/acp/`) spawns `claude-code-acp`
  / `codex-acp` as stdio subprocesses. Backend is user-switchable.
- **Grounding:** agent-native file tools read `data/papers/<slug>/paper.md`
  directly. **No custom RAG / embeddings.**
- **Storage:** SQLite (`core/store/`, better-sqlite3) for state; files on disk
  for paper content.

```
electron/   main.ts, preload.ts        (Node side)
src/        React renderer (tabs, library, reader, right panel)
core/       acp/  ingest/  store/  library/   (main-process backend logic)
data/       runtime papers + app.db (gitignored — starts empty)
.claude/skills/  8 mattpocock skills + caveman
```

## Commands

```bash
npm install
npm run dev         # electron-vite dev (hot reload)
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # production bundle
npm run dist        # electron-builder package
```

## Guardrails

- **Never** bridge subscription OAuth into a third-party harness — banned by
  Anthropic (Feb 2026), actively blocked. Only official ACP adapters.
- **No** raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path — auth from signed-in CLIs.
- **No** Python, **no** custom RAG (unless a real large-corpus wall is hit).
- Check the **GitHub wiki** for the open task card before adding scope. MVP is
  the Phase-1 loop; breadth is Phase 2+.
