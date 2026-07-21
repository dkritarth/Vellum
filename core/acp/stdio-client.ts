// StdioAcpClient — the real ACP transport. See client.ts for the contract and
// AGENTS.md for the hard rules this file must never violate.
//
// Each backend is spawned as a first-party ACP server subprocess and spoken
// to over stdio via JSON-RPC (ndjson), using the official
// `@agentclientprotocol/sdk` (npm, verified 2026-07-21 — the current
// canonical ACP TypeScript lib; the older `@zed-industries/agent-client-protocol`
// name is deprecated and renamed to this package).
//
// Auth is whatever the adapter subprocess itself resolves (the signed-in
// `claude` / `codex` CLI). This module never reads ANTHROPIC_API_KEY /
// OPENAI_API_KEY and never attempts to bridge subscription OAuth into a
// third-party harness.

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk'

import type {
  AcpBackend,
  AcpClient,
  AcpPromptRequest,
  AcpSession,
  AcpUpdate,
} from './client.js'

/** The shape of the adapter subprocess: stdin/stdout piped (ACP transport),
 * stderr inherited (adapter diagnostics go straight to Vellum's own stderr). */
type AdapterChildProcess = ChildProcessByStdio<Writable, Readable, null>

/** First-party adapter subprocess per backend. Do not add others here without
 * a card — this is the whole point of the "no OAuth bridge" guardrail. */
const ADAPTERS: Record<AcpBackend, { command: string; args: string[] }> = {
  claude: { command: 'claude-code-acp', args: [] },
  codex: { command: 'codex-acp', args: [] },
}

/** Spawns the adapter subprocess for a backend. Overridable for tests so unit
 * tests never require a live, signed-in `claude-code-acp` / `codex-acp` on
 * PATH — see stdio-client.test.ts, which substitutes a small local ndjson
 * ACP-agent script in place of the real adapter. */
export type SpawnAdapter = (backend: AcpBackend) => AdapterChildProcess

/** `claude-code-acp` refuses to launch when it sees `CLAUDECODE` set (the
 * signal a parent process is itself a Claude Code session) — it hard-exits
 * with "Claude Code cannot be launched inside another Claude Code session
 * ... To bypass this check, unset the CLAUDECODE environment variable."
 * That env var (and its companion `CLAUDE_CODE_SSE_PORT`) leaks into any
 * child spawned from inside a Claude Code terminal — a developer shell, one
 * of our own agents, or the smoke test itself — even though Vellum's own
 * Electron process never sets it. Stripping both from the adapter's env
 * makes the client robust to running nested, with no behavior change for
 * the normal (non-nested) case. Everything else the adapter needs for auth
 * (PATH, HOME, the CLI's own creds/config env) passes through untouched.
 * Exported standalone so the stripping is unit-testable without a
 * subprocess. */
export function buildAdapterEnv(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { CLAUDECODE, CLAUDE_CODE_SSE_PORT, ...rest } = sourceEnv
  return rest
}

const defaultSpawnAdapter: SpawnAdapter = (backend) => {
  const { command, args } = ADAPTERS[backend]
  return spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: buildAdapterEnv(),
  }) as AdapterChildProcess
}

/** Maps a raw ACP `SessionUpdate` onto Vellum's `AcpUpdate` contract.
 * Exported standalone so the mapping can be unit-tested without a subprocess. */
export function mapSessionUpdate(update: SessionUpdate): AcpUpdate {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      return { kind: 'text', data: update.content }
    case 'tool_call':
      return { kind: 'tool_call', data: update }
    case 'tool_call_update':
      return { kind: 'tool_result', data: update }
    // plan / mode / config / usage / command updates don't have a bespoke
    // AcpUpdate kind yet (contract only defines text/tool_call/tool_result/
    // done/error). Surface them as tool_result so nothing is silently
    // dropped; revisit the contract if a UI needs to key off these directly.
    default:
      return { kind: 'tool_result', data: update }
  }
}

function toPromptBlocks(req: AcpPromptRequest): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text: req.text }]
  for (const path of req.contextFiles ?? []) {
    blocks.push({ type: 'resource_link', uri: pathToFileURL(path).toString(), name: path })
  }
  return blocks
}

/** Minimal async queue: one producer (session/update notifications + the
 * final done/error from the prompt() RPC settling), one consumer (the
 * AsyncIterable a caller pulls from). */
class UpdateQueue implements AsyncIterable<AcpUpdate> {
  private readonly buffered: AcpUpdate[] = []
  private readonly waiters: Array<(result: IteratorResult<AcpUpdate>) => void> = []
  private closed = false

  push(update: AcpUpdate): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: update, done: false })
    else this.buffered.push(update)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()!({ value: undefined, done: true })
    }
  }

  private next(): Promise<IteratorResult<AcpUpdate>> {
    if (this.buffered.length > 0) {
      return Promise.resolve({ value: this.buffered.shift()!, done: false })
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  [Symbol.asyncIterator](): AsyncIterator<AcpUpdate> {
    return { next: () => this.next() }
  }
}

/** Rejects when the child process errors or exits non-zero before the ACP
 * handshake completes — otherwise a missing/broken adapter binary just hangs
 * `connection.initialize()` forever waiting for stdout that will never come. */
/** Builds the friendly diagnostic for a dead adapter process, and a promise
 * that rejects with it. Exposed separately (`describe`) so callers can also
 * consult it synchronously after the fact — see the comment in `newSession`. */
function describeChildFailure(child: AdapterChildProcess, command: string): { message(): string | undefined } {
  let message: string | undefined
  child.once('error', (err) => {
    message ??= `failed to spawn ACP adapter '${command}': ${err.message}`
  })
  child.once('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      message ??= `ACP adapter '${command}' exited with code ${code}`
    } else if (signal) {
      message ??= `ACP adapter '${command}' was killed by signal ${signal}`
    }
  })
  return { message: () => message }
}

function childFailure(child: AdapterChildProcess, command: string, tracker: { message(): string | undefined }): Promise<never> {
  return new Promise((_, reject) => {
    child.once('error', () => reject(new Error(tracker.message() ?? `ACP adapter '${command}' failed`)))
    child.once('exit', () => {
      const message = tracker.message()
      if (message) reject(new Error(message))
    })
  })
}

/** Per-operation timeout budgets. Both are optional constructor args with
 * sane defaults — existing `new StdioAcpClient()` / `new
 * StdioAcpClient(spawnAdapter)` callers are unaffected. */
export interface StdioAcpClientTimeouts {
  /** Budget for `initialize` + `session/new` before `newSession()` rejects
   * and the child is killed. Shorter than the turn budget — a hung handshake
   * means the adapter never came up, not that it's doing slow work. */
  handshakeMs?: number
  /** Budget for a single `prompt()` turn (send to a terminal done/error)
   * before it's force-failed with an `error` update and the child is
   * killed. Guards against a stalled adapter (e.g. an errored codex-acp
   * turn, or any other hang) leaving callers awaiting forever. */
  turnMs?: number
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000
const DEFAULT_TURN_TIMEOUT_MS = 60_000

/** Rejects with `message` after `ms`. `cancel()` clears the underlying timer
 * — always call it once the raced-against operation settles, otherwise the
 * timer keeps the process alive and the rejection still fires (harmlessly,
 * since nothing awaits it, but it's a leak). */
function timeoutAfter(ms: number, message: string): { promise: Promise<never>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout>
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  // Swallow-if-uncaught: if the raced-against operation wins, nothing ever
  // awaits this promise, and an unhandled rejection would otherwise surface.
  promise.catch(() => undefined)
  return {
    promise,
    cancel: () => clearTimeout(timer),
  }
}

class StdioAcpSession implements AcpSession {
  // Set only while a prompt() call is in flight — one prompt at a time per
  // session, mirroring the ACP protocol (a session has one active turn).
  private queue: UpdateQueue | undefined
  private disposed = false
  // Set only while a prompt() call is in flight; cleared by dispose() too so
  // an external dispose mid-turn doesn't leave a dangling timer.
  private turnTimeout: { cancel(): void } | undefined

  constructor(
    private readonly connection: ClientSideConnection,
    private readonly sessionId: string,
    private readonly child: AdapterChildProcess,
    private readonly turnMs: number,
  ) {}

  /** Routes a `session/update` notification to the in-flight prompt's queue,
   * if this is that session and a prompt is actually in flight. Called
   * directly by the `Client.sessionUpdate` handler in `StdioAcpClient`. */
  route(sessionId: string, update: AcpUpdate): void {
    if (sessionId === this.sessionId) this.queue?.push(update)
  }

  async *prompt(req: AcpPromptRequest): AsyncIterable<AcpUpdate> {
    if (this.disposed) {
      yield { kind: 'error', data: { message: 'session disposed' } }
      return
    }

    const queue = new UpdateQueue()
    this.queue = queue

    let settled = false
    const timeout = timeoutAfter(this.turnMs, `ACP turn timed out after ${this.turnMs}ms`)
    this.turnTimeout = timeout

    this.connection
      .prompt({ sessionId: this.sessionId, prompt: toPromptBlocks(req) })
      .then((res) => {
        if (settled) return
        settled = true
        timeout.cancel()
        queue.push({ kind: 'done', data: { stopReason: res.stopReason } })
        queue.close()
      })
      .catch((err: unknown) => {
        if (settled) return
        settled = true
        timeout.cancel()
        queue.push({ kind: 'error', data: { message: err instanceof Error ? err.message : String(err) } })
        queue.close()
      })

    // Turn timeout: if neither branch above settles first, force-fail the
    // turn, dispose the child (a stalled adapter isn't going to recover mid
    // process lifetime) so this and any future prompt on this session error
    // out immediately rather than hang.
    timeout.promise.catch((err: Error) => {
      if (settled) return
      settled = true
      queue.push({ kind: 'error', data: { message: err.message } })
      queue.close()
      this.disposed = true
      this.child.kill()
    })

    try {
      yield* queue
    } finally {
      if (this.queue === queue) this.queue = undefined
      if (this.turnTimeout === timeout) this.turnTimeout = undefined
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.turnTimeout?.cancel()
    this.turnTimeout = undefined
    this.queue?.close()
    this.queue = undefined
    this.child.kill()
  }
}

/** Real ACP transport: spawns the backend's first-party adapter subprocess
 * and drives it over stdio JSON-RPC via `@agentclientprotocol/sdk`. */
export class StdioAcpClient implements AcpClient {
  constructor(
    private readonly spawnAdapter: SpawnAdapter = defaultSpawnAdapter,
    private readonly timeouts: StdioAcpClientTimeouts = {},
  ) {}

  async newSession(backend: AcpBackend): Promise<AcpSession> {
    const command = ADAPTERS[backend].command
    const child = this.spawnAdapter(backend)
    const tracker = describeChildFailure(child, command)
    const failure = childFailure(child, command, tracker)
    const handshakeMs = this.timeouts.handshakeMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    const handshake = timeoutAfter(handshakeMs, `ACP handshake timed out after ${handshakeMs}ms`)

    // Set once the session below is created; sessionUpdate notifications
    // that arrive before then (shouldn't happen pre-handshake) are dropped.
    let session: StdioAcpSession | undefined

    const toClient = (_agent: Agent): Client => ({
      sessionUpdate: (params: SessionNotification) => {
        session?.route(params.sessionId, mapSessionUpdate(params.update))
      },
      requestPermission: (req: RequestPermissionRequest): RequestPermissionResponse => {
        // Headless client, no UI wired yet (that's a later card). Auto-allow
        // so the on-plan smoke test can complete unattended; auto-reject if
        // the adapter offers no allow option. Revisit once the Ask panel
        // wires a real permission prompt.
        const allow = req.options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
        return {
          outcome: allow ? { outcome: 'selected', optionId: allow.optionId } : { outcome: 'cancelled' },
        }
      },
    })

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    )
    const connection = new ClientSideConnection(toClient, stream)

    // Surface the child's own exit/spawn diagnostics rather than whatever
    // generic "connection closed" error the transport layer raises when the
    // adapter process disappears mid-handshake — `failure` almost always
    // carries the more actionable message, but which promise wins the race
    // against `connection.initialize()`/`newSession()` is a timing accident,
    // so prefer `failure`'s reason whenever the child has in fact exited.
    try {
      await Promise.race([
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        }),
        failure,
        handshake.promise,
      ])

      const newSessionResult = await Promise.race([
        connection.newSession({ cwd: process.cwd(), mcpServers: [] }),
        failure,
        handshake.promise,
      ])
      handshake.cancel()
      const turnMs = this.timeouts.turnMs ?? DEFAULT_TURN_TIMEOUT_MS
      session = new StdioAcpSession(connection, newSessionResult.sessionId, child, turnMs)
      return session
    } catch (err) {
      handshake.cancel()
      child.kill()
      // Whether the transport's generic "connection closed" error or the
      // child's own exit/spawn diagnostic wins the race above is a timing
      // accident. `failure` settles once the child actually exits/errors
      // (already underway, since something just made the connection fail) —
      // wait for it so the more actionable child diagnostic wins. A
      // handshake timeout is its own clear diagnostic, so don't wait on
      // `failure` for that case (the child may just sit there, never
      // exiting, until `child.kill()` above takes effect).
      if (err instanceof Error && err.message.startsWith('ACP handshake timed out')) {
        throw err
      }
      await failure.catch(() => undefined)
      const message = tracker.message()
      throw message ? new Error(message) : err
    }
  }
}
