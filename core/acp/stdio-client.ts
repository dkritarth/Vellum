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

const defaultSpawnAdapter: SpawnAdapter = (backend) => {
  const { command, args } = ADAPTERS[backend]
  return spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] }) as AdapterChildProcess
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

class StdioAcpSession implements AcpSession {
  // Set only while a prompt() call is in flight — one prompt at a time per
  // session, mirroring the ACP protocol (a session has one active turn).
  private queue: UpdateQueue | undefined
  private disposed = false

  constructor(
    private readonly connection: ClientSideConnection,
    private readonly sessionId: string,
    private readonly child: AdapterChildProcess,
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

    this.connection
      .prompt({ sessionId: this.sessionId, prompt: toPromptBlocks(req) })
      .then((res) => {
        queue.push({ kind: 'done', data: { stopReason: res.stopReason } })
        queue.close()
      })
      .catch((err: unknown) => {
        queue.push({ kind: 'error', data: { message: err instanceof Error ? err.message : String(err) } })
        queue.close()
      })

    try {
      yield* queue
    } finally {
      if (this.queue === queue) this.queue = undefined
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.queue?.close()
    this.queue = undefined
    this.child.kill()
  }
}

/** Real ACP transport: spawns the backend's first-party adapter subprocess
 * and drives it over stdio JSON-RPC via `@agentclientprotocol/sdk`. */
export class StdioAcpClient implements AcpClient {
  constructor(private readonly spawnAdapter: SpawnAdapter = defaultSpawnAdapter) {}

  async newSession(backend: AcpBackend): Promise<AcpSession> {
    const command = ADAPTERS[backend].command
    const child = this.spawnAdapter(backend)
    const tracker = describeChildFailure(child, command)
    const failure = childFailure(child, command, tracker)

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
      ])

      const newSessionResult = await Promise.race([
        connection.newSession({ cwd: process.cwd(), mcpServers: [] }),
        failure,
      ])
      session = new StdioAcpSession(connection, newSessionResult.sessionId, child)
      return session
    } catch (err) {
      child.kill()
      // Whether the transport's generic "connection closed" error or the
      // child's own exit/spawn diagnostic wins the race above is a timing
      // accident. `failure` settles once the child actually exits/errors
      // (already underway, since something just made the connection fail) —
      // wait for it so the more actionable child diagnostic wins.
      await failure.catch(() => undefined)
      const message = tracker.message()
      throw message ? new Error(message) : err
    }
  }
}
