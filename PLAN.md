# Vellum — Plan

Local-first AI paper workspace inspired by anara.com. Built for Kritarth's
incoming Computer Science Ph.D. workflow: review papers, understand difficult
passages, preserve notes and annotations, and perform deep paper-grounded analysis.
It runs on **your own** Claude/Codex plan via **ACP** — no extra AI subscription,
no raw API key.

## Product goal

Vellum replaces the parts of a paid paper-analysis tool Kritarth needs every day,
without becoming a generic Anara clone. Core journey:

1. Add a real paper from arXiv, DOI, URL, or local PDF.
2. Read and navigate PDF inside desktop app.
3. Select text and choose **Add to chat** or **Explain**.
4. Ask follow-up questions grounded in paper, with section/passage references.
5. Save summaries, chats, notes, and annotations for later research.

Current priority: make this journey reliable through Kritarth's signed-in Codex
subscription and `codex-acp`. Claude remains supported through same unified seam.

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

### Phase 1 — implemented baseline, now stabilization target

Code for ingest → read → chat exists. “Merged” does not prove product reliability.
Re-test full loop in running Electron app with real papers. Claude has live smoke
evidence; Codex remains unverified until current signed-in adapter succeeds.

- Ingest: arXiv / DOI / PDF URL / local PDF → markdown + metadata via ACP agent
- Library grid → open paper in a **tab**
- PDF reader: render, page nav, zoom, TOC, in-doc search
- **Ask** tab: chat grounded in the paper's file via the ACP agent
- **Model selector** = real Claude/Codex ACP switch (the premise proof)
- Auto **Summary** on ingest; **Quick actions** (canned prompts); **Details** tab

### Phase 2 — research workflow

PDF selection → **Add to chat / Explain** · highlight tool + **Annotations** tab ·
**Notes** tab (SQLite) · inline citation
click-through · ORCID badges · folder tree/collections · **Chats** library view ·
suggested-questions generation · Trash · Usage · multi-workspace switcher ·
`/` skills + `@` context in the input.

### Phase 3 — depth (deferred)

Cross-paper synthesis · citation graph · AI writing editor · Zotero import ·
large-corpus retrieval (only if a real wall is hit).

## Where work lives

This file records product direction and locked architecture decisions. It is not a
task backlog. **GitHub Issues are sole executable source of truth.** Issues carry
phases, dependency locks, scope, acceptance criteria, and live-verification evidence.
Agents work only issues labeled `status:ready`; milestone gates unlock later phases.
See `AGENTS.md` for execution contract.

## Prior art

- **anara.com** — the UX target (this repo mirrors its layout).
- **PaperQuay** (Electron+React+TS, local-first) — reference for backend infra
  patterns; borrow bits, but Vellum's differentiator is the ACP-multi-backend,
  runs-on-your-own-plan, no-extra-key angle.
