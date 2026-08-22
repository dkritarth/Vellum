# Vellum

Local-first AI paper workspace for reviewing, understanding, annotating, and
analyzing research papers. Inspired by [anara.com](https://anara.com), Vellum runs
on **your own** Claude or Codex plan
via **ACP** (Agent Client Protocol). No extra AI subscription, no raw API key:
it uses the Agent-SDK credit already bundled in your Claude plan, or your
ChatGPT plan through Codex — swappable at runtime.

Ingest a paper (arXiv ID, DOI, PDF URL, or local file), read it in-app, select a
difficult passage, send it to chat or ask for an explanation, and continue with
paper-grounded analysis through the agent's own file tools.

## Status

Early, partially working product. Phase-1 code has landed, but user journeys still
need live Electron validation and repair. Claude ACP has live smoke evidence;
Codex ACP is current priority and remains unverified until a signed-in run succeeds.
The previous CLI prototype is preserved on `archive/cli-prototype`.

- **GitHub Issues** — authoritative phased backlog, dependency locks, verification
- **PLAN.md** — product direction and locked decisions; not task backlog
- **CLAUDE.md** — architecture map + commands + guardrails
- **AGENTS.md** — agent conventions and how work flows from the wiki
- **GitHub wiki** — historical design/card archive; not task authority

## Quick start

```bash
npm install
npm run dev
```

Requires `claude-code-acp` / `codex-acp` on PATH and their CLIs signed in
(see the wiki's ACP-Integration page).

## Why

anara.com is great but wants its own subscription. Vellum reuses the plan you
already pay for, keeps your papers local, and is swappable across AI backends
via ACP. Licensed for personal and non-commercial use; commercial use needs
prior written permission. See [LICENSE](LICENSE).
