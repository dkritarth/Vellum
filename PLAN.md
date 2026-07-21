# Vellum — Plan

Local-first AI paper workspace (anara.com-style) that runs on **your own**
Claude/Codex plan via **ACP** — no extra API subscription, no raw API key.

## Premise (read the boundary carefully)

Vellum uses the **sanctioned** first-party paths only:

- **Claude** via `claude-code-acp` → draws from the Agent-SDK credit bundled in
  your Pro/Max plan (official since 2026-06-15).
- **Codex** via `codex-acp` → draws from your ChatGPT plan (Codex sign-in).

It does **not** — and must never — bridge subscription OAuth into a third-party
harness. Anthropic banned that (Feb 2026) and actively blocks it. This means
Vellum runs on credit **already bundled in your plans**, not "infinite free AI":
heavy use can still exhaust the plan credit.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Approach | Fresh product (learn from PaperQuay, not a fork) |
| 2 | Name | Vellum |
| 3 | Backends | Both, swappable via **unified ACP client** |
| 4 | Shell | Electron |
| 5 | Language | Pure Node/TS (no Python) |
| 6 | Grounding | Agent-native file tools (no custom RAG/embeddings) |
| 7 | Storage | SQLite (better-sqlite3) for state + files for content |
| 8 | MVP shape | Full shell visible; core loop wired; rest stubbed |
| 9 | Data | Starts empty (old CLI corpus lives in `archive/cli-prototype`) |

## Phases

### Phase 1 — MVP vertical loop (functional)

Prove ingest → read → chat on your own plan, end to end.

- Ingest: arXiv / DOI / PDF URL / local PDF → markdown + metadata via ACP agent
- Library grid → open paper in a **tab**
- PDF reader: render, page nav, zoom, TOC, in-doc search
- **Ask** tab: chat grounded in the paper's file via the ACP agent
- **Model selector** = real Claude/Codex ACP switch (the premise proof)
- Auto **Summary** on ingest; **Quick actions** (canned prompts); **Details** tab

### Phase 2 — shell stubs → real logic (the wiki backlog)

Highlight tool + **Annotations** tab · **Notes** tab (SQLite) · inline citation
click-through · ORCID badges · folder tree/collections · **Chats** library view ·
suggested-questions generation · Trash · Usage · multi-workspace switcher ·
`/` skills + `@` context in the input.

### Phase 3 — depth (deferred)

Cross-paper synthesis · citation graph · AI writing editor · Zotero import ·
large-corpus retrieval (only if a real wall is hit).

## Where work lives

The **GitHub wiki** is the task backlog. Each phase is a set of task cards with
scope, files, and acceptance criteria. Agents pick up a card, implement it
test-first, and open a PR against `master` linking the card. See `AGENTS.md`.

## Prior art

- **anara.com** — the UX target (this repo mirrors its layout).
- **PaperQuay** (Electron+React+TS, local-first) — reference for backend infra
  patterns; borrow bits, but Vellum's differentiator is the ACP-multi-backend,
  runs-on-your-own-plan, no-extra-key angle.
