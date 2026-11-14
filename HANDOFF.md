# Vellum — Current Handoff

Read `AGENTS.md`, `PLAN.md`, and `CLAUDE.md` first. Those files define product
goal, guardrails, testing standard, and PR workflow. GitHub Issues are sole
executable backlog; PLAN and wiki do not authorize work.

## Current state

- Fourteen Phase-1 cards are merged. Treat them as implemented baseline, not proof
  of reliable product behavior.
- Claude ACP has live on-plan smoke evidence.
- Codex ACP is current priority because Kritarth currently uses a Codex
  subscription. A signed-in smoke run passed under issue #25 (closed); evidence is
  in `docs/verification/codex-acp-2026-08-12.md`. Re-verify with current signed-in
  CLI and adapter; never infer success from mocks or model-selector UI.
- Phase-0 gate #28 is still open. Find the current ready task with
  `gh issue list --label status:ready`; all other issues stay blocked behind
  explicit dependency and milestone gates.

## Next objective

Exercise full journey in running Electron app with a real paper:

1. Ingest from supported source.
2. Find paper in Library and open it.
3. Read, navigate, zoom, search, and select PDF text.
4. Add selection to chat or ask Vellum to explain it.
5. Receive grounded Codex response referencing paper content.
6. Reload/restart and confirm durable research state remains.

Record every failure as reproducible GitHub issue with expected behavior. Fix
blockers test-first in focused PRs. Claim only issue labeled `status:ready`; closing
each independently verified issue unlocks exactly one successor.

## Verification contract

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

For UI changes, automated checks are necessary but insufficient. Launch app, use
visible controls, inspect console, test failure/empty/restart paths, and capture
screenshot evidence when tooling permits. For ACP work, run relevant live signed-in
smoke test. Disclose anything unavailable or unverified.

## PR contract

One GitHub issue per branch and PR against `master`. Use `Closes #<issue>`. Include
acceptance criteria, tests, live verification evidence, real-paper/ACP evidence when
applicable, known limitations, and follow-up defects. Self-review before requesting
review. Maintainer updates issue labels only after merge and required verification.
