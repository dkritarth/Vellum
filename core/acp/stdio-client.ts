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
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
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
const ADAPTERS: Record<AcpBackend, { command: string }> = {
  // `claude-agent-acp` is the current name of the first-party Claude adapter
  // (@agentclientprotocol/claude-agent-acp). The old `claude-code-acp` package
  // is deprecated and too old for current Claude models, but still works as a
  // fallback when it is the only one installed.
  claude: { command: 'claude-agent-acp' },
  codex: { command: 'codex-acp' },
  // Google's own Antigravity CLI, run as an ACP server. It owns Google sign-in
  // and token storage (macOS keychain); Vellum never touches its credentials.
  antigravity: { command: 'agy' },
}

/** Resolves the executable for a backend. Antigravity honours
 * `VELLUM_AGY_PATH`, then `agy` on PATH, then `~/.local/bin/agy` — a GUI-launched
 * Electron app on macOS does not inherit the shell PATH, and `~/.local/bin` is
 * where a user-level CLI install usually lands. */
export function resolveAdapterCommand(
  backend: AcpBackend,
  sourceEnv: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const { command } = ADAPTERS[backend]
  if (backend === 'claude') {
    return onPath(command, sourceEnv, fileExists) ? command : LEGACY_CLAUDE_COMMAND
  }
  if (backend !== 'antigravity') return command
  const override = sourceEnv.VELLUM_AGY_PATH?.trim()
  if (override) return override
  if (onPath(command, sourceEnv, fileExists)) return command
  const userLocal = join(sourceEnv.HOME ?? homedir(), '.local', 'bin', command)
  return fileExists(userLocal) ? userLocal : command
}

const LEGACY_CLAUDE_COMMAND = 'claude-code-acp'

function onPath(command: string, sourceEnv: NodeJS.ProcessEnv, fileExists: (path: string) => boolean): boolean {
  return (sourceEnv.PATH ?? '').split(delimiter).some((dir) => dir !== '' && fileExists(join(dir, command)))
}

/** Legacy adapter compatibility. Current codex-acp reads CODEX_CONFIG instead;
 * JSON string encoding keeps the legacy TOML value in one argv entry. */
export function buildAdapterArgs(
  backend: AcpBackend,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  if (backend === 'antigravity') {
    // Separate app-data dir from the interactive `agy` CLI's own history,
    // matching Antigravity's documented ACP layout. Sign-in is shared.
    return ['acp', '--app-data-dir', 'antigravity-acp']
  }
  const model = sourceEnv.VELLUM_CODEX_MODEL?.trim()
  return backend === 'codex' && model ? ['-c', `model=${JSON.stringify(model)}`] : []
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
 * (PATH, HOME, the CLI's own creds/config env) passes through. For Codex only,
 * a nonblank VELLUM_CODEX_MODEL replaces CODEX_CONFIG.model in the copied env.
 * Every backend drops raw Anthropic/OpenAI API-key env vars; Antigravity also
 * drops raw Google API-key/cloud credential env vars.
 * Exported standalone for tests at the child-environment boundary. */
export function buildAdapterEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  backend?: AcpBackend,
): NodeJS.ProcessEnv {
  const { CLAUDECODE, CLAUDE_CODE_SSE_PORT, ...rest } = sourceEnv
  const model = sourceEnv.VELLUM_CODEX_MODEL?.trim()
  if (backend === 'codex' && model) {
    let config: unknown = {}
    if (sourceEnv.CODEX_CONFIG !== undefined) {
      try {
        config = JSON.parse(sourceEnv.CODEX_CONFIG)
      } catch {
        // Parser diagnostics may contain config secrets. Never attach the cause.
        throw new Error('Cannot apply VELLUM_CODEX_MODEL: CODEX_CONFIG must be a JSON object')
      }
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Cannot apply VELLUM_CODEX_MODEL: CODEX_CONFIG must be a JSON object')
    }
    rest.CODEX_CONFIG = JSON.stringify({ ...config, model })
  }
  // No raw API-key path for any backend: a key left in the user's shell must
  // never take precedence over the signed-in subscription CLI.
  for (const key of RAW_API_KEY_ENV) delete rest[key]
  if (backend === 'antigravity') {
    // Same rule as the other backends: auth comes from the signed-in CLI,
    // never from a raw API key or cloud credential sitting in the env.
    for (const key of ANTIGRAVITY_SCRUBBED_ENV) delete rest[key]
  }
  return rest
}

const RAW_API_KEY_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']

const ANTIGRAVITY_SCRUBBED_ENV = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_GENAI_USE_VERTEXAI',
]

/** Model override for Antigravity (e.g. `claude-sonnet-4-6`), applied with
 * ACP `session/set_config_option` after `session/new`. Unset = agent default. */
export function antigravityModelOverride(sourceEnv: NodeJS.ProcessEnv = process.env): string | undefined {
  return sourceEnv.VELLUM_ANTIGRAVITY_MODEL?.trim() || undefined
}

/** ACP error code agents use for "authentication required". */
const ACP_AUTH_REQUIRED = -32000

/** Turns an auth-required failure into an actionable message for the user. */
export function describeSessionError(backend: AcpBackend, err: unknown): Error | undefined {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  if (code !== ACP_AUTH_REQUIRED) return undefined
  if (backend === 'antigravity') {
    return new Error('Antigravity is not signed in. Run `agy acp --login` in a terminal, then try again.')
  }
  return new Error(`${ADAPTERS[backend].command} is not signed in. Sign in with its CLI, then try again.`)
}

const defaultSpawnAdapter: SpawnAdapter = (backend) => {
  return spawn(resolveAdapterCommand(backend), buildAdapterArgs(backend), {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: buildAdapterEnv(process.env, backend),
    detached: process.platform !== 'win32',
  }) as AdapterChildProcess
}

const PROCESS_EXIT_GRACE_MS = 1_000

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return !processGroupExists(pid)
}

async function waitForChildExit(child: AdapterChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    const finish = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', finish)
    child.once('error', finish)
  })
}

async function terminateAdapter(child: AdapterChildProcess): Promise<void> {
  // A spawn failure has no pid and no process tree to terminate. Its tracked
  // ENOENT/permission diagnostic must remain the error returned to callers.
  if (child.pid === undefined) return

  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill()
    if (await waitForChildExit(child, PROCESS_EXIT_GRACE_MS)) return
    child.kill('SIGKILL')
    if (await waitForChildExit(child, PROCESS_EXIT_GRACE_MS)) return
    throw new Error('ACP adapter process did not exit after forced termination')
  }

  const pid = child.pid
  if (!processGroupExists(pid)) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill()
  }
  if (await waitForProcessGroupExit(pid, PROCESS_EXIT_GRACE_MS)) return

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
  if (!(await waitForProcessGroupExit(pid, PROCESS_EXIT_GRACE_MS))) {
    throw new Error(`ACP adapter process group ${pid} did not exit after forced termination`)
  }
}

/** Maps a raw ACP `SessionUpdate` onto Vellum's `AcpUpdate` contract.
 * Exported standalone so the mapping can be unit-tested without a subprocess. */
export function mapSessionUpdate(update: SessionUpdate): AcpUpdate {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return { kind: 'text', data: update.content }
    // Only the agent's answer is 'text'. Some agents (agy) echo the user's
    // prompt back as user_message_chunk and stream reasoning as
    // agent_thought_chunk; treating those as text pasted the prompt and the
    // model's private reasoning into the answer and into persisted chats.
    case 'user_message_chunk':
    case 'agent_thought_chunk':
      return { kind: 'tool_result', data: update }
    case 'tool_call':
      return { kind: 'tool_call', data: update }
    case 'tool_call_update':
      return { kind: 'tool_result', data: update }
    case 'usage_update':
      return { kind: 'usage_update', data: update }
    // plan / mode / config / command updates don't have a bespoke
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
   * and the child is killed. NOT shorter than the turn budget — measured
   * against a real cold-start `claude-code-acp` (CLAUDECODE stripped):
   * `initialize` returns in ~226ms, but `session/new` legitimately takes
   * ~16.2s (it loads a large skill/command set — a huge
   * `available_commands_update` dump, dozens of skills). A tighter budget
   * here regresses a previously-working (if slow) path. Default leaves
   * comfortable margin above that measured cold-start cost. */
  handshakeMs?: number
  /** Maximum idle time during `prompt()`. Each matching session update
   * resets this budget, so productive turns may run longer. A stalled
   * adapter is force-failed and its process tree terminated. */
  turnMs?: number
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60_000
const DEFAULT_TURN_TIMEOUT_MS = 60_000

/** Rejects with `message` after `ms`. `cancel()` clears the underlying timer
 * — always call it once the raced-against operation settles, otherwise the
 * timer keeps the process alive and the rejection still fires (harmlessly,
 * since nothing awaits it, but it's a leak). */
function timeoutAfter(ms: number, message: string): { promise: Promise<never>; cancel(): void; reset(): void } {
  let timer: ReturnType<typeof setTimeout>
  let active = true
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  // Swallow-if-uncaught: if the raced-against operation wins, nothing ever
  // awaits this promise, and an unhandled rejection would otherwise surface.
  promise.catch(() => undefined)
  return {
    promise,
    cancel: () => {
      active = false
      clearTimeout(timer)
    },
    reset: () => { if (active) timer.refresh() },
  }
}

class StdioAcpSession implements AcpSession {
  // Set only while a turn is in flight — one turn at a time per session,
  // mirroring the ACP protocol (a session has one active turn).
  private queue: UpdateQueue | undefined
  private disposed = false
  private disposePromise: Promise<void> | undefined
  // Set only while a prompt() call is in flight; cleared by dispose() too so
  // an external dispose mid-turn doesn't leave a dangling timer.
  private turnTimeout: { cancel(): void; reset(): void } | undefined
  // ACP allows one active turn per session, and `route()` can only feed one
  // queue. Overlapping prompt() calls wait here until every earlier turn has
  // settled (done / error / timeout / dispose) before sending their own.
  private turnTail: Promise<void> = Promise.resolve()
  private releaseWaiters: (() => void) | undefined
  private readonly disposedSignal = new Promise<void>((resolve) => {
    this.releaseWaiters = resolve
  })

  constructor(
    private readonly connection: ClientSideConnection,
    private readonly sessionId: string,
    private readonly child: AdapterChildProcess,
    private readonly turnMs: number,
    private readonly childFailureMessage: () => string | undefined,
  ) {}

  /** Error text for a rejected `session/prompt`. A JSON-RPC error from a
   * live adapter is reported as-is. When the transport closed because the
   * adapter process died, the SDK only says "ACP connection closed"; wait
   * (bounded) for the child's exit and prefer its exit-code/signal
   * diagnostic, mirroring what `newSession` does for handshake failures. */
  private async promptFailureMessage(err: unknown): Promise<string> {
    const fallback = err instanceof Error ? err.message : String(err)
    if (!this.connection.signal.aborted) return fallback
    await waitForChildExit(this.child, PROCESS_EXIT_GRACE_MS)
    return this.childFailureMessage() ?? fallback
  }

  /** Routes a `session/update` notification to the in-flight prompt's queue,
   * if this is that session and a prompt is actually in flight. Called
   * directly by the `Client.sessionUpdate` handler in `StdioAcpClient`. */
  route(sessionId: string, update: AcpUpdate): void {
    if (sessionId === this.sessionId && this.queue) {
      this.turnTimeout?.reset()
      this.queue.push(update)
    }
  }

  async *prompt(req: AcpPromptRequest): AsyncIterable<AcpUpdate> {
    if (this.disposed) {
      yield { kind: 'error', data: { message: 'session disposed' } }
      return
    }

    // Reserve this turn's slot. The slot is released when the turn settles
    // on the wire, not when the consumer stops iterating, so an abandoned
    // iterator cannot let the next turn overlap one still running.
    const previousTurn = this.turnTail
    let releaseTurn!: () => void
    this.turnTail = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })
    let started = false
    try {
      await Promise.race([previousTurn, this.disposedSignal])
      if (this.disposed) {
        yield { kind: 'error', data: { message: 'session disposed' } }
        return
      }
      started = true
      yield* this.runTurn(req, releaseTurn)
    } finally {
      if (!started) releaseTurn()
    }
  }

  private async *runTurn(req: AcpPromptRequest, releaseTurn: () => void): AsyncGenerator<AcpUpdate> {
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
        queue.push({ kind: 'done', data: { stopReason: res.stopReason, ...(res.usage ? { usage: res.usage } : {}) } })
        queue.close()
        releaseTurn()
      })
      .catch(async (err: unknown) => {
        if (settled) return
        settled = true
        timeout.cancel()
        const message = await this.promptFailureMessage(err)
        queue.push({ kind: 'error', data: { message } })
        queue.close()
        releaseTurn()
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
      releaseTurn()
      void this.dispose().catch(() => undefined)
    })

    try {
      yield* queue
    } finally {
      if (this.queue === queue) this.queue = undefined
      if (this.turnTimeout === timeout) this.turnTimeout = undefined
    }
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.releaseWaiters?.()
    this.turnTimeout?.cancel()
    this.turnTimeout = undefined
    // A consumer whose iterator just ends treats the turn as complete (the
    // chat manager persists the partial text as the reply). Disposal
    // interrupts the turn, so say so explicitly before closing.
    this.queue?.push({ kind: 'error', data: { message: 'session disposed' } })
    this.queue?.close()
    this.queue = undefined
    this.disposePromise = terminateAdapter(this.child)
    return this.disposePromise
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
          clientInfo: { name: 'vellum', version: '0.1.0' },
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
      const model = backend === 'antigravity' ? antigravityModelOverride() : undefined
      if (model) {
        await Promise.race([
          connection.setSessionConfigOption({
            sessionId: newSessionResult.sessionId,
            configId: 'model',
            value: model,
          }),
          failure,
          handshake.promise,
        ])
      }
      handshake.cancel()
      const turnMs = this.timeouts.turnMs ?? DEFAULT_TURN_TIMEOUT_MS
      session = new StdioAcpSession(connection, newSessionResult.sessionId, child, turnMs, tracker.message)
      return session
    } catch (err) {
      handshake.cancel()
      await terminateAdapter(child)
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
      const authError = describeSessionError(backend, err)
      if (authError) throw authError
      await failure.catch(() => undefined)
      const message = tracker.message()
      throw message ? new Error(message) : err
    }
  }
}
