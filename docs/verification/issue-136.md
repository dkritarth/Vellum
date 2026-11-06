# Issue #136 model override verification

Verified 2026-11-06 UTC. Scope: Codex spawn environment only.

## Official contract

Inspected installed `@agentclientprotocol/codex-acp` **2.2.2** at
`/home/dandapat/.local/node-v24.19.0-linux-x64/lib/node_modules/@agentclientprotocol/codex-acp`.
Upstream: [official repository](https://github.com/agentclientprotocol/codex-acp).
The following locations refer to this installed release, not moving upstream lines:

- `README.md:70-72` documents `CODEX_PATH`, `CODEX_CONFIG` as a JSON object
  merged into session config, and `MODEL_PROVIDER`.
- `dist/index.js:45636-45659` handles `--version`, `login`, and `cli`;
  ordinary server startup parses `CODEX_CONFIG`, not arbitrary `-c` argv.
- `dist/index.js:35437-35460` builds session config from adapter config.
- `dist/index.js:35335` sends `sessionConfig.config` in `threadStart`.

Vellum now copies the environment, trims a nonblank `VELLUM_CODEX_MODEL`, and
replaces only `CODEX_CONFIG.model` for Codex. Other object keys survive.
Invalid JSON, null, arrays, and scalar config values fail before spawn with a
fixed diagnostic, without raw config or parser cause. No override means no
config parsing or rewriting. Claude config stays untouched. Legacy `-c` argv
remains for compatibility with older adapters.

## Automated evidence

Existing public environment/spawn interfaces only; no new transport framework.

- Red: subprocess regression received `model: "old"` instead of requested
  quoted model containing internal newline. Focused run: 1 failed, 20 passed.
- Green: same regression passed after env fix, 21/21 tests.
- Final focused run: 33/33 tests, including quotes/whitespace, frozen source env,
  preserved nested keys, absent config, missing/blank model, invalid JSON and
  shapes with safe diagnostics, and Claude isolation.
- Full `npm test`: 41 files, 393 tests passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.

## Actual adapter, simulated app-server

A temporary executable supplied through documented `CODEX_PATH` spoke controlled
app-server JSON-RPC. Actual installed adapter ran unchanged. Vellum's exported
`buildAdapterEnv` and `buildAdapterArgs` configured the spawned adapter through
`SpawnAdapter`. An isolated temporary HOME and minimal env contained no real
credentials or API keys. Test config included an old model, `service_tier` set
to `default`, and a custom nested key. Capture of the actual adapter's outgoing
`thread/start` contained:

```json
{"model":"model \"quoted\"","service_tier":"default","custom":{"keep":true}}
```

The fake app-server captured params and intentionally returned an error before
any model response. Probe asserted these three values and exited 0. This proves
adapter config delivery, not authentication or successful inference. Temporary
probe script and output remain outside the repo at
`/tmp/vellum-136-contract-probe.ts` and `/tmp/vellum-136-contract.log`.

## Live first-party smoke, unverified

```bash
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u CODEX_API_KEY \
  -u DEFAULT_AUTH_REQUEST MODEL_PROVIDER=openai \
  CODEX_CONFIG='{"service_tier":"default"}' \
  VELLUM_CODEX_MODEL=gpt-6.1-sol INITIAL_AGENT_MODE=read-only \
  npm run smoke:acp -- codex
```

Actual run: `2026-11-06T00:16:02.425Z` to `00:16:18.964Z`.
Stream reported `workspace routing discovery unauthorized (401)`, then
`done={"stopReason":"end_turn"}`. Existing smoke printed
`VERIFIED — stream ended in a done update.` and exited 0. That verdict is false
for successful inference. No `pong` or useful model answer arrived. #135 owns
smoke verdict correction; this change does not modify `smoke.ts`.

Log: `/tmp/vellum-136-live.log`. Earlier supplied parent evidence at
`/tmp/vellum-firstparty-codex-smoke.log` showed the same routing failure.
Signed-in success and requested-model inference remain **unverified**. No
credentials were inspected, no personal config was edited, and no API-key path
was used. Provider/read-only/default-tier settings above are probe-only, not
new product defaults. Electron UI and real-paper verification are inapplicable
to this spawn-env-only change. Independent live review remains outstanding.
