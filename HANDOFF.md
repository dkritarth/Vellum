# Vellum — Orchestrator Handoff

Handoff for a fresh session (e.g. Codex) picking up the Vellum Phase-1 build.
You are the **orchestrator**: plan, dispatch work per task card, review against
acceptance criteria + guardrails, and merge. Written 2026-07-21.

Read `CLAUDE.md`, `AGENTS.md`, `PLAN.md` at repo root first. The GitHub **wiki**
is the backlog: `git clone https://github.com/dkritarth/Vellum.wiki.git`.

---

## 1. Where things stand

- **Master:** `github.com/dkritarth/Vellum`, branch `master` is **protected** —
  every change lands via PR, never push to master.
- **HEAD:** `aaaf1ca` (P1-10 merged). **11 of 14 Phase-1 cards done.**
- **Tests:** `npm test` → **137 passing** from a clean checkout. Typecheck clean.
- **Node 26 / macOS arm64.**

### Merged (done)
P1-01 ACP client (#1) · P1-02 SQLite store (#4) · P1-03 ingest classify+fetch
(#2) · P1-04 PDF→md (#5) · P1-05 agent extract (#7) · P1-06 ingest store+IPC
(#10) · P1-07 shell (#3) · P1-08 library grid (#12) · P1-09 reader (#9) · P1-10
Ask chat over ACP (#13) · P1-14 stubs (#6). Plus infra: #8 ACP hardening, #11
run-config fix.

### Remaining Phase-1 cards (do these, in this order)
Read the full card text in the wiki `Phase-1-MVP.md`. All three depend on P1-10
(merged). **They contend on shared shell files — see the conflict notes.**

| Card | What | Primary files | Conflict risk |
|------|------|---------------|---------------|
| **P1-11** | Model dropdown → real Claude/Codex ACP backend switch (premise proof in UI) | `src/app/ModelSelector.tsx`, `src/app/RightPanel.tsx` (model region), `src/app/AskPanel.tsx`, `core/chat/manager.ts`, `core/chat/repo.ts` | shares `RightPanel.tsx` + `AskPanel.tsx` |
| **P1-12** | Auto-summary on ingest (ACP) + Details tab | `core/ingest/summary.ts` (new), `core/ingest/index.ts`, `src/app/DetailsPanel.tsx`, `src/app/RightPanel.tsx` (Details region), maybe a `summary` migration | shares `RightPanel.tsx` |
| **P1-13** | Quick actions (Breakdown / Practice / Study guide canned prompts) | `src/app/QuickActions.tsx`, `src/app/AskPanel.tsx` | shares `AskPanel.tsx` |

**Sequencing to avoid merge conflicts:** P1-11 and P1-12 touch different regions
of `RightPanel.tsx` (model area vs Details tab) — can run in parallel, resolve a
small conflict at merge (merge one, rebase the other). **P1-13 shares
`AskPanel.tsx` with P1-11 — run P1-13 only after P1-11 is merged.** Simplest safe
path: P1-11 → P1-12 → P1-13 sequentially. Faster path: P1-11 ∥ P1-12, then P1-13.

After P1-13, **Phase 1 is complete**. Stop there and report; Phase 2/3 backlog
lives in the wiki (`Phase-2-Backlog.md`, `Phase-3-Deferred.md`) — do not pull it
forward without a card.

---

## 2. The orchestration loop

For each card:

1. **Pick** the next unblocked card from wiki `Phase-1-MVP.md` (respect deps).
2. **Dispatch one worker per card** in an **isolated git worktree** so parallel
   workers don't collide. One card = one worktree = one branch = one PR.
   - If your harness has a sub-agent/parallel-task tool with worktree isolation,
     use it (model: a mid-tier coding model is enough; these cards are well-scoped).
   - If not, do the card yourself in a dedicated worktree:
     `git worktree add .claude/worktrees/p1-XX -b p1-XX master`, build there,
     open the PR, then `git worktree remove`.
3. **Review** the PR against the card's acceptance criteria **and** the guardrails
   (§4). Verify independently — don't just trust the worker's report:
   - `gh pr view <n> --json mergeable`
   - In the PR's worktree: `npm install --ignore-scripts` (or `npm install` +
     `npm approve-scripts better-sqlite3` if it needs the native build),
     `npm run typecheck`, and `npx vitest run <changed-dirs>`.
   - Grep for guardrail violations (§4).
   - For anything touching SQL, ACP, or IPC, read the actual diff.
4. **Merge** with `gh pr merge <n> --squash`, then `git pull --ff-only origin master`.
5. **Update the wiki** (§3). **Prune the worktree** (§5 — critical).
6. Move to the next card.

### Worker task-prompt template
Give each worker a prompt containing: the card id + full scope/files/acceptance
criteria from the wiki; "read AGENTS.md + wiki Architecture + ACP-Integration
first"; "work test-first"; the guardrails (§4); "run `npm run typecheck` +
`npm test`, open a PR against master linking the card, list criteria met"; and
**"do not touch files outside this card's scope"**. Tell it which region of any
shared file it owns (§1 conflict notes). Tell it **not** to add an `allowScripts`
block or touch build config (already handled on master).

---

## 3. Updating the wiki

The wiki is a separate git repo:

```bash
git clone https://github.com/dkritarth/Vellum.wiki.git
cd Vellum.wiki
# edit Phase-1-MVP.md: set the card's "**Status:**" line to
#   ✅ done — PR #<n>.   /   🔄 in progress.   /   ⬜ not started — blocked on [P1-XX].
# update the "## Progress" banner count at the top of Phase-1-MVP.md
git commit -am "Update Phase-1 progress: <card> merged (PR #<n>)"
git push
```

Keep `Phase-1-MVP.md` statuses and the progress banner in sync with master after
every merge. Record notable facts (verified dep names, on-plan proof, gotchas) in
`ACP-Integration.md` when relevant.

---

## 4. Hard guardrails (reject any PR that violates these)

- **ACP first-party only.** Spawn `claude-code-acp` / `codex-acp` via
  `core/acp/`. **Never** bridge subscription OAuth into a third-party harness
  (banned + blocked). **No** raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path —
  auth comes from the signed-in CLIs. Do not modify `core/acp/client.ts` /
  `stdio-client.ts` for feature cards; consume the contract.
- **No Python.** Pure Node/TS. (node-gyp using python as a *build tool* for
  native modules is fine — that's not app code.)
- **No custom RAG / embeddings.** Grounding = the ACP agent reads
  `data/papers/<slug>/paper.md` itself via `contextFiles`.
- **Storage split:** SQLite (`core/store`, better-sqlite3) for state; files on
  disk for paper *content*. Chat history in SQLite is fine (it's state). Never
  put paper markdown in the DB.
- **Parameterized SQL only.** Whitelist any `ORDER BY` column; never interpolate
  user input. (See `core/library/repo.ts` for the established pattern.)
- **Renderer isolation.** `src/` never imports `electron`/`node:`/`fs`/
  `child_process`/`better-sqlite3` — only `window.vellum` (the preload bridge).
- **TypeScript strict**, no `any` without a justifying comment. Tests colocated
  `*.test.ts(x)`, `vitest`. Every card ships tests. ACP + network + native are
  **mocked** in unit tests (fake `AcpClient`, stubbed `fetch`, in-memory DB).

---

## 5. Known gotchas (you WILL hit these)

- **Worktree test-glob noise.** Leftover agent worktrees under
  `.claude/worktrees/` each contain their own `core/`/`src/` + `node_modules`,
  so `npx vitest run` from repo root globs into them and reports hundreds of
  phantom failures. **Always prune worktrees after merging** and re-run:
  ```bash
  for wt in $(git worktree list --porcelain | grep '^worktree' | awk '{print $2}' | grep '.claude/worktrees/agent-'); do git worktree remove -f -f "$wt"; done
  git worktree prune
  ```
  A clean checkout has **137 tests**. Anything like "392 tests, 81 failed" = you
  forgot to prune.
- **npm allow-scripts policy** on this machine blocks install scripts. The
  `allowScripts` block in `package.json` (committed) covers better-sqlite3 /
  electron / esbuild / fsevents. If a fresh `npm install` skips native builds,
  run `npm approve-scripts better-sqlite3 electron esbuild fsevents`. **Do not
  remove the allowScripts block** (it's harmless on standard npm).
- **ACP client env.** `claude-code-acp` refuses to launch inside a Claude Code
  session (`CLAUDECODE` set); the client already strips
  `CLAUDECODE`/`CLAUDE_CODE_SSE_PORT` from the adapter env. A Codex session
  likely won't set `CLAUDECODE`, so this is a non-issue for you, but keep the
  strip in place.
- **ACP cold start ~16s.** `session/new` for `claude-code-acp` loads a big skill
  set. Timeouts are 60s handshake/turn — keep them generous.
- **Codex backend not yet verified.** `@zed-industries/codex-acp@0.16.0` is too
  old for the current Codex CLI (`gpt-5.6-luna requires a newer version of
  Codex`). Upgrade codex + codex-acp, then `npm run smoke:acp -- codex`. P1-11
  is about *routing*, not guaranteeing codex is signed in.
- **Reader `.pdf` byte detach:** unpdf detaches the ArrayBuffer during parse —
  `core/ingest/index.ts` already passes a `.slice()` copy; don't undo that.

---

## 6. How to verify the app really works

- **Unit/typecheck:** `npm run typecheck` + `npx vitest run` (after pruning
  worktrees).
- **ACP on-plan smoke:** `npm run smoke:acp -- claude` → expect
  `VERIFIED — stream ended in a done update`. (Claude is verified; codex needs
  the upgrade above.)
- **Real end-to-end ingest** (proves fetch→convert→extract(ACP)→store), needs
  `claude-code-acp` signed in:
  ```bash
  npx tsx -e "import {openDb} from './core/store/db.ts'; import {ingest} from './core/ingest/index.ts'; const db=openDb(); console.log(await ingest('1706.03762',{db})); db.close();"
  ```
  Already done once — `data/papers/arxiv-1706.03762/` exists (Attention Is All
  You Need) with a matching DB row. Use it to test P1-12 (Details/summary) and
  the Library→Reader path.
- **Launch the app:** `npm run dev` (boots after #11's fixes). No display in a
  headless env; on a Mac it opens the window. Library grid → click the paper →
  Reader renders it → Ask tab streams a grounded answer (needs claude-code-acp).

---

## 7. First moves for the new session

1. Clone the wiki; read `Phase-1-MVP.md` (cards P1-11/12/13) + `ACP-Integration.md`.
2. Confirm clean state: prune worktrees, `npm run typecheck`, `npx vitest run`
   (expect 137).
3. Dispatch **P1-11** (worktree-isolated). Optionally **P1-12** in parallel
   (different RightPanel region). Hold **P1-13** until P1-11 merges.
4. Review → merge → update wiki → prune worktree. Repeat through P1-13.
5. Phase 1 done → report. Consider a small card to fully verify the **codex**
   backend once the adapter is upgraded, and a card to convert the run-config
   fixes' `sandbox:false` into a CJS-preload if the sandbox is wanted back.
