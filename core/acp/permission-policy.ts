// Deny-by-default policy for ACP `session/request_permission`.
//
// Vellum agents read paper.md, which is extracted from arbitrary PDFs and
// arXiv downloads, so its text is untrusted: a hidden "run this command"
// instruction must not be able to obtain edit or execute permission. Vellum
// has no permission prompt UI yet, so the client grants only requests that
// cannot change the machine or reach outside the paper directory, and
// refuses everything else.
//
// This policy is the second line of defence. The first is the session mode
// that stdio-client.ts forces at session creation (Claude `default`, Codex
// `read-only`): adapters in their default modes approve in-workspace writes
// themselves and never ask this client at all.
import { lstatSync, readlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'

/** Tool kinds that only observe local state. `fetch` is deliberately absent:
 * it reaches the network, so injected paper text could use it to exfiltrate
 * the paper or other local content, and grounding never needs it. `read` and
 * `search` are further limited to the session directory (see below). */
export const ALLOWED_TOOL_KINDS: ReadonlySet<string> = new Set(['read', 'search', 'think'])

/** Kinds whose targets must resolve inside the session directory. */
const PATH_SCOPED_KINDS: ReadonlySet<string> = new Set(['read', 'search'])

export interface PermissionDecision {
  response: RequestPermissionResponse
  /** Raw `toolCall.kind` the adapter reported, or `undefined` when absent. */
  kind: string | undefined
  title: string | undefined
  decision: 'allow' | 'reject' | 'cancelled'
  optionId?: string
  /** Why a normally allowed kind was refused, for the audit log. */
  reason?: string
}

export interface PermissionPolicyOptions {
  /** Session working directory (the paper directory). `read` and `search`
   * requests naming any path outside it are refused. */
  cwd?: string
}

function pickOption(options: PermissionOption[], kinds: PermissionOption['kind'][]): PermissionOption | undefined {
  for (const kind of kinds) {
    const match = options.find((option) => option.kind === kind)
    if (match) return match
  }
  return undefined
}

/** `rawInput` keys that name a single filesystem target. */
const PATH_KEYS = ['path', 'file_path', 'filePath', 'filepath', 'file', 'filename', 'notebook_path', 'directory', 'dir', 'cwd', 'uri', 'url']
/** `rawInput` keys that hold a list of filesystem targets. */
const PATH_LIST_KEYS = ['paths', 'files', 'file_paths', 'filePaths', 'directories']
/** `rawInput` keys that carry a glob; only checked when they can escape. */
const GLOB_KEYS = ['pattern', 'glob']
/** A bracket or brace group containing a dot can expand to `.` or `..`. */
const GLOB_DOT_CLASS = /\[[^\]]*\.|\{[^}]*\./
/** `rawInput` keys that mean the request is not a local file search. */
const REMOTE_KEYS = ['query', 'queries', 'url']

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Every filesystem target the request names. */
function collectTargets(req: RequestPermissionRequest): string[] {
  const targets: string[] = []
  const toolCall = req.toolCall as { locations?: unknown; rawInput?: unknown } | undefined
  if (Array.isArray(toolCall?.locations)) {
    for (const location of toolCall.locations) {
      const path = nonEmptyString(asRecord(location)?.path)
      if (path) targets.push(path)
    }
  }
  const input = asRecord(toolCall?.rawInput)
  if (input) {
    for (const key of PATH_KEYS) {
      const value = nonEmptyString(input[key])
      if (value) targets.push(value)
    }
    for (const key of PATH_LIST_KEYS) {
      const list = input[key]
      if (Array.isArray(list)) for (const item of list) {
        const value = nonEmptyString(item)
        if (value) targets.push(value)
      }
    }
    for (const key of GLOB_KEYS) {
      // A glob only needs checking when it can leave the search root.
      const value = nonEmptyString(input[key])
      if (value && (isAbsolute(value) || value.startsWith('~') || value.includes('..') || GLOB_DOT_CLASS.test(value))) targets.push(value)
    }
  }
  return targets
}

function looksRemote(req: RequestPermissionRequest): boolean {
  const input = asRecord((req.toolCall as { rawInput?: unknown } | undefined)?.rawInput)
  if (!input) return false
  if (input.type === 'webSearch') return true
  return REMOTE_KEYS.some((key) => input[key] !== undefined && input[key] !== null)
}

/** Resolves symlinks of the longest existing prefix, then appends the rest, so
 * a path that does not exist yet still resolves through any symlinked parent. */
function realResolve(path: string): string {
  return resolveComponents(resolve(path), 0)
}

const MAX_SYMLINK_HOPS = 40

/** Walks `abs` one component at a time with lstat, following symlinks via
 * readlink even when the link target does not exist (a dangling link inside
 * cwd must still resolve to where it points). */
function resolveComponents(abs: string, depth: number): string {
  if (depth > MAX_SYMLINK_HOPS) return abs
  const parts = abs.split(sep).filter((part) => part !== '')
  let current: string = sep
  let hops = 0
  for (let i = 0; i < parts.length; i++) {
    const next = join(current, parts[i])
    let target: string | undefined
    try {
      if (lstatSync(next).isSymbolicLink()) target = readlinkSync(next)
    } catch {
      // Missing component: nothing further can be a link; append the rest.
      return join(next, ...parts.slice(i + 1))
    }
    if (target === undefined) {
      current = next
      continue
    }
    if (++hops + depth > MAX_SYMLINK_HOPS) return join(next, ...parts.slice(i + 1))
    const linked = isAbsolute(target) ? resolve(target) : resolve(current, target)
    return resolveComponents(join(linked, ...parts.slice(i + 1)), depth + hops)
  }
  return current
}

/** True when `target` (absolute, relative to `cwd`, or a file: URI) resolves
 * inside `cwd` after symlinks and `..` are resolved. */
export function isInsideDirectory(target: string, cwd: string): boolean {
  let path = target
  if (/^file:\/\//i.test(path)) {
    try {
      path = fileURLToPath(path)
    } catch {
      return false
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('~')) {
    return false
  }
  // Drop a trailing glob so `/paper/dir/**/*.md` resolves to its fixed prefix.
  // The glob part must never be able to climb: truncating `*/../../etc/*` to
  // `*` would hide the `..` segments, so refuse any glob that can expand to
  // `..` (a `..` anywhere, or a bracket/brace group containing a dot).
  const globAt = path.search(/[*?[{]/)
  if (globAt >= 0) {
    const globPart = path.slice(globAt)
    if (globPart.includes('..') || GLOB_DOT_CLASS.test(globPart)) return false
    path = path.slice(0, globAt) || '.'
  }
  const root = realResolve(resolve(cwd))
  const real = realResolve(isAbsolute(path) ? resolve(path) : resolve(root, path))
  const rel = relative(root, real)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Returns the reason a `read`/`search` request must be refused, or undefined. */
function scopeViolation(kind: string, req: RequestPermissionRequest, cwd: string | undefined): string | undefined {
  if (!PATH_SCOPED_KINDS.has(kind)) return undefined
  if (cwd === undefined) return 'no session directory to scope the request to'
  const targets = collectTargets(req)
  const outside = targets.find((target) => !isInsideDirectory(target, cwd))
  if (outside !== undefined) return 'path outside the session directory'
  if (kind === 'read' && targets.length === 0) return 'no path determinable for read'
  if (kind === 'search' && targets.length === 0 && looksRemote(req)) return 'search without a local path (web search)'
  return undefined
}

export function decidePermission(req: RequestPermissionRequest, policy: PermissionPolicyOptions = {}): PermissionDecision {
  const kind = typeof req.toolCall?.kind === 'string' ? req.toolCall.kind : undefined
  const title = typeof req.toolCall?.title === 'string' ? req.toolCall.title : undefined
  const options = Array.isArray(req.options) ? req.options : []

  let reason: string | undefined
  if (kind !== undefined && ALLOWED_TOOL_KINDS.has(kind)) {
    reason = scopeViolation(kind, req, policy.cwd)
    if (reason === undefined) {
      // Prefer one-shot grants so approving a read never persists a blanket allow.
      const allow = pickOption(options, ['allow_once', 'allow_always'])
      if (allow) {
        return { response: { outcome: { outcome: 'selected', optionId: allow.optionId } }, kind, title, decision: 'allow', optionId: allow.optionId }
      }
      return { response: { outcome: { outcome: 'cancelled' } }, kind, title, decision: 'cancelled' }
    }
  }

  // reject_once keeps a refusal scoped to this call; reject_always would
  // silently pre-refuse later calls the user may want, but is still a refusal.
  const reject = pickOption(options, ['reject_once', 'reject_always'])
  if (reject) {
    return { response: { outcome: { outcome: 'selected', optionId: reject.optionId } }, kind, title, decision: 'reject', optionId: reject.optionId, ...(reason ? { reason } : {}) }
  }
  return { response: { outcome: { outcome: 'cancelled' } }, kind, title, decision: 'cancelled', ...(reason ? { reason } : {}) }
}
