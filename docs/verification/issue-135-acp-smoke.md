# ACP smoke verdict, issue #135

Verified CLI failure reporting on 2026-11-06 UTC. Codex subscription support
remains **unverified**.

Verdict requires concatenated text, trimmed only at its edges, equal to `pong`;
`done.stopReason` equal to `end_turn`; and no error update or thrown prompt/stream
failure. A terminal event alone proves only completion. Acquired sessions dispose
in `finally`. Tests use the existing CLI entry function with injected `AcpClient`;
imports do not launch adapters. Product transport and defaults unchanged.

## Automated evidence

- First regression failed before verdict fix: 401 diagnostic text plus `done`
  left exit code 0, expected 1. Non-success stops and thrown prompt/stream failures
  also failed before their fixes.
- Baseline replay using `origin/master` verdict plus only import-safe client
  injection: 15 failed, 5 passed. Missing/wrong text and non-success stops exposed
  false positives. Corrected focused suite: 20 passed.
- `npm test`: 42 files, 400 tests passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Coverage includes chunked pong with surrounding whitespace for both backends,
  diagnostics, missing/wrong text, unsupported stop reasons, missing completion,
  error updates, thrown session/prompt/stream failures, disposal, and default
  backend order with an earlier failure preserved.

## Actual first-party run

Installed package: `@agentclientprotocol/codex-acp` 2.2.2. Command-local overrides
only; personal configuration and credentials unchanged. Default service tier;
read-only initial mode. No API-key or default-auth override supplied.

```bash
env -u DEFAULT_AUTH_REQUEST -u OPENAI_API_KEY -u CODEX_API_KEY \
  MODEL_PROVIDER=openai \
  CODEX_CONFIG='{"model":"gpt-6.1-sol","service_tier":"default"}' \
  INITIAL_AGENT_MODE=read-only npm run smoke:acp -- codex
```

Observed from `2026-11-06T00:11:54.252Z` to `2026-11-06T00:12:11.656Z`:

```text
text="Warning: Falling back from WebSockets to HTTPS transport. workspace routing discovery unauthorized (401)\n\n"
text="workspace routing discovery unauthorized (401)\n\n"
done={"stopReason":"end_turn"}
UNVERIFIED — expected exactly pong and successful completion.
exit=1
```

Raw local log: `/tmp/vellum-135-codex-smoke.log`. Process inspection after exit
found no matching smoke or adapter process. Parent's pre-fix run of this same
failure pattern reported VERIFIED/exit 0; corrected CLI rejects it.

## Limits and follow-up

No successful live pong, no live Claude run, no Electron UI or real-paper run.
Issue scope changes CLI verdict only; mocks do not establish signed-in support.
Independent live review remains pending. Optional model override `-c` mismatch
tracked separately in [#137](https://github.com/dkritarth/Vellum/issues/137), blocked.
No transport, authentication, provider, sandbox, or model defaults changed here.
