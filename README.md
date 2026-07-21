# Vellum

Local-first AI paper workspace — an open, Electron desktop tool styled after
[anara.com](https://anara.com) that runs on **your own** Claude or Codex plan
via **ACP** (Agent Client Protocol). No extra AI subscription, no raw API key:
it uses the Agent-SDK credit already bundled in your Claude plan, or your
ChatGPT plan through Codex — swappable at runtime.

Ingest a paper (arXiv ID, DOI, PDF URL, or local file), read it in-app, and chat
with it — grounded directly in the paper by the agent's own file tools.

## Status

Early rewrite. This branch is the fresh Vellum product; the previous CLI
prototype is preserved on the `archive/cli-prototype` branch.

- **PLAN.md** — concept, locked decisions, phase roadmap
- **CLAUDE.md** — architecture map + commands + guardrails
- **AGENTS.md** — agent conventions and how work flows from the wiki
- **GitHub wiki** — the task backlog agents build from

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
