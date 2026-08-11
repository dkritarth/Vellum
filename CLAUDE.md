# CLAUDE.md

Guidance for Claude Code (and any agent) working in the **Vellum** repo.

## What this is and why it matters

Vellum is Kritarth's local-first Electron research workspace for his incoming
Computer Science Ph.D. at Michigan State University. It should help him ingest,
review, understand, annotate, and deeply analyze research papers. It borrows useful
workflow ideas from anara.com without requiring another paid subscription.

AI runs through subscriptions Kritarth already has via first-party ACP adapters.
Current validation priority is **Codex** through `codex-acp`; Claude remains
supported through `claude-code-acp`. Selected PDF text must become useful context:
at minimum, users can add it to chat or ask Vellum to explain it.

Read `PLAN.md` for product direction and `AGENTS.md` for complete execution,
testing, delegation, security, and PR contract. GitHub Issues—not PLAN or wiki—are
authoritative task specifications. This file stays a short map.

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

## Current execution priority

Phase-1 code is present, but do not equate merged cards or passing unit tests with a
working product. Reproduce and stabilize the real Electron journey first: ingest →
library → reader → selection → Ask/Explain → grounded Codex response → persisted
state. Every UI change requires live clicking/typing verification in addition to
tests, typecheck, and build. Codex support stays “unverified” until a signed-in live
smoke test succeeds.

## Guardrails

- **Never** bridge subscription OAuth into a third-party harness — banned by
  Anthropic (Feb 2026), actively blocked. Only official ACP adapters.
- **No** raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path — auth from signed-in CLIs.
- **No** Python, **no** custom RAG (unless a real large-corpus wall is hit).
- Work only open GitHub issue labeled `status:ready`. Never start a blocked issue or
  infer tasks from PLAN/wiki. Never mark work done without live evidence for
  user-facing behavior.
