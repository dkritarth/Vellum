// Live on-plan smoke test for [P1-01]. NOT a unit test — this spawns the
// *real* `claude-code-acp` / `codex-acp` adapters on PATH and drives a real
// ACP session over stdio, proving the sanctioned local-plan path actually
// works end to end (no API key, no OAuth bridge — see AGENTS.md).
//
// Requires the adapter CLI(s) installed and already signed in to your
// Claude Pro/Max or ChatGPT plan on this machine. Run with:
//
//   npm run smoke:acp                 # tries both backends
//   npm run smoke:acp -- claude       # just claude-code-acp
//   npm run smoke:acp -- codex        # just codex-acp
//
// This script deliberately does NOT run as part of `npm test` / CI — the
// mocked unit tests in stdio-client.test.ts cover the transport logic
// without requiring a live, signed-in adapter.
//
// Nested-session note: `claude-code-acp` refuses to launch when the
// CLAUDECODE env var is set (i.e. when this smoke runs from inside a Claude
// Code terminal/agent). StdioAcpClient now strips CLAUDECODE /
// CLAUDE_CODE_SSE_PORT from the adapter's child env by default (see
// `buildAdapterEnv` in stdio-client.ts), so this smoke no longer needs
// `env -u CLAUDECODE` to pass when run nested. If you still hit the "cannot
// be launched inside another Claude Code session" error, it means something
// upstream of StdioAcpClient is re-adding CLAUDECODE to the environment —
// as a manual workaround you can still re-run with `env -u CLAUDECODE npm
// run smoke:acp`.
//
// Hang note: every ACP call StdioAcpClient makes (handshake + each turn) now
// has a timeout (defaults: 60s handshake, 60s turn — see
// StdioAcpClientTimeouts). The handshake budget is deliberately generous:
// measured against a real cold-start claude-code-acp, `session/new` alone
// legitimately takes ~16s (it loads a large skill/command set). A stalled
// adapter still fails loud with a timeout error instead of hanging this
// script forever; no external alarm/kill needed.

import { StdioAcpClient } from './stdio-client.js'
import type { AcpBackend } from './client.js'

const PROMPT = 'Reply with exactly the word "pong" and nothing else.'

async function smoke(backend: AcpBackend): Promise<void> {
  console.log(`\n=== ${backend} (${backend === 'claude' ? 'claude-code-acp' : 'codex-acp'}) ===`)
  const client = new StdioAcpClient()
  let session
  try {
    session = await client.newSession(backend)
  } catch (err) {
    console.log(`UNVERIFIED — could not open a session: ${err instanceof Error ? err.message : String(err)}`)
    console.log(
      `  -> install/sign in the adapter, confirm it's on PATH, then re-run: npm run smoke:acp -- ${backend}`,
    )
    return
  }

  try {
    let sawDone = false
    for await (const update of session.prompt({ text: PROMPT })) {
      console.log(JSON.stringify(update))
      if (update.kind === 'done') sawDone = true
      if (update.kind === 'error') {
        console.log(`UNVERIFIED — adapter reported an error mid-turn.`)
        return
      }
    }
    console.log(sawDone ? 'VERIFIED — stream ended in a done update.' : 'UNVERIFIED — stream ended without done.')
  } finally {
    await session.dispose()
  }
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2) as AcpBackend[]
  const backends: AcpBackend[] = requested.length > 0 ? requested : ['claude', 'codex']
  for (const backend of backends) {
    await smoke(backend)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
