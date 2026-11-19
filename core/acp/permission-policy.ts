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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
/** A path component that starts with a dot and a wildcard (`.*`, `.?`) can match `..`. */
const LEADING_DOT_WILDCARD = /^\.[*?]/
/** True when a multi-component path has such a component. A bare `.*` is left
 * alone: it is a common regex and, with no further component, only names entries. */
function hasLeadingDotWildcard(path: string): boolean {
  const parts = path.split(/[\\/]/)
  return parts.length > 1 && parts.some((part) => LEADING_DOT_WILDCARD.test(part))
}
/** `rawInput` keys that mean the request is not a local file search. */
const REMOTE_KEYS = ['query', 'queries', 'url']

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** True when `pattern` is a regex, not a glob. Claude's Grep reports the
 * title `grep …` (claude-agent-acp reporters/search.js) and takes `pattern`
 * (regex) plus an optional `glob` file filter; Glob reports `Find …` and takes
 * `pattern` as a glob. A regex cannot name a path, so only globs need the
 * escape check. Only the title decides: input keys are attacker-shapeable,
 * so adding `output_mode` to a Glob call must not switch its check off. */
function patternIsRegex(req: RequestPermissionRequest): boolean {
  const title = (req.toolCall as { title?: unknown } | undefined)?.title
  return typeof title === 'string' && /^grep\b/.test(title)
}

/** A bracket or brace group containing a separator or `~` can expand to an
 * absolute or home path (`{/etc,x}/*`, `[/]etc`, `{~,x}/.ssh`). */
const GLOB_ROOT_CLASS = /\[[^\]]*[\\/~]|\{[^}]*[\\/~]/

/** Why a vetted key holds a value of the wrong shape, or undefined. Path and
 * glob keys take one string, list keys an array of strings; anything else
 * (an array under `path`, a number, an object) is refused rather than skipped,
 * since a tool may still interpret it as a path. */
function vettedShapeError(input: Record<string, unknown>): string | undefined {
  for (const key of [...PATH_KEYS, ...GLOB_KEYS]) {
    const value = input[key]
    if (value !== undefined && value !== null && typeof value !== 'string') return 'unexpected value under a path key'
  }
  for (const key of PATH_LIST_KEYS) {
    const value = input[key]
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))) {
      return 'unexpected value under a path key'
    }
  }
  return undefined
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
    const regex = patternIsRegex(req)
    for (const key of GLOB_KEYS) {
      if (key === 'pattern' && regex) continue
      // Every glob is resolved: besides `..` and absolute forms, its fixed
      // prefix may pass through a symlink in the session directory.
      const value = nonEmptyString(input[key])
      if (value) targets.push(value)
    }
  }
  return targets
}

const MAX_LOOSE_STRINGS = 500
const MAX_LOOSE_DEPTH = 8

interface StringScan {
  strings: string[]
  /** A bound was hit, so strings were left unexamined. */
  truncated: boolean
}

/** Strings in `rawInput` under keys the allow-lists do not already vet, bounded
 * in depth and count. Hitting a bound sets `truncated` so the caller fails closed. */
function collectStrings(value: unknown, scan: StringScan, depth = 0): void {
  if (typeof value === 'string') {
    if (scan.strings.length >= MAX_LOOSE_STRINGS) scan.truncated = true
    else scan.strings.push(value)
    return
  }
  if (typeof value !== 'object' || value === null) return
  if (depth >= MAX_LOOSE_DEPTH) {
    scan.truncated = true
    return
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectStrings(item, scan, depth + 1)
}

/** Top-level keys already vetted precisely (path keys) or that hold regex or
 * glob text (`pattern`, `glob`; globs are checked by `collectTargets`). */
const VETTED_KEYS: ReadonlySet<string> = new Set([...PATH_KEYS, ...PATH_LIST_KEYS, ...GLOB_KEYS])

function scanLooseStrings(rawInput: unknown): StringScan {
  const scan: StringScan = { strings: [], truncated: false }
  const input = asRecord(rawInput)
  if (!input) {
    collectStrings(rawInput, scan)
    return scan
  }
  for (const [key, value] of Object.entries(input)) {
    if (VETTED_KEYS.has(key) && (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')))) continue
    collectStrings(value, scan, 1)
  }
  return scan
}

/** Delimiters that can sit between prose and a path: whitespace, commas,
 * semicolons, quotes, brackets, `=`, `|`, `&`, `<`, `>`. */
const TOKEN_DELIMITERS = /[\s,;"'`()[\]{}<>=|&]+/
/** A `~` that names a home directory (`~`, `~/x`, `~user/x`), not `~5%`. */
const HOME_TOKEN = /^~([\\/]|$|[A-Za-z_][\w.-]*([\\/]|$))/

/** True when a string, or any delimiter-separated token of it, is an absolute
 * path, home path, URL or `..` path that leaves the session directory. Prose
 * (`e.g. ~5%`, `3.2/4`, `so..`) is left alone. Applied to keys the policy does
 * not know (`source`, `note`, ...) so they cannot smuggle a path past the scoping. */
function looseValueEscapes(value: string, cwd: string): boolean {
  // A second split on `:` catches `key:/etc/passwd` without breaking `https://`.
  const tokens = value.split(TOKEN_DELIMITERS).flatMap((token) => [token, ...token.split(':')])
  return [value, ...tokens].some((candidate) => {
    if (candidate === '') return false
    if (candidate.split(/[\\/]/).includes('..') && (/[\\/]/.test(candidate) || candidate === value)) return true
    if (HOME_TOKEN.test(candidate) || /^file:/i.test(candidate) || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) || isAbsolute(candidate)) {
      return !isInsideDirectory(candidate, cwd)
    }
    return false
  })
}

/** True when `rawInput`, or any object nested in it, looks like a web search. */
function looksRemote(req: RequestPermissionRequest): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > MAX_LOOSE_DEPTH || typeof value !== 'object' || value === null) return false
    if (Array.isArray(value)) return value.some((item) => visit(item, depth + 1))
    const record = value as Record<string, unknown>
    if (record.type === 'webSearch' || record.type === 'search') return true
    if (REMOTE_KEYS.some((key) => record[key] !== undefined && record[key] !== null)) return true
    return Object.values(record).some((item) => visit(item, depth + 1))
  }
  return visit((req.toolCall as { rawInput?: unknown } | undefined)?.rawInput, 0)
}

/** Resolves `path` the way the OS does: component by component, following
 * symlinks, and applying `..` to the real parent. Never normalise lexically
 * first: `link/..` with `link -> /outside/sub` is `/outside`, not the
 * directory holding `link`. A path that does not exist yet resolves through
 * any symlinked parent. Throws (callers fail closed) on any lstat error other
 * than a missing component, or on too many symlink hops. */
function realResolve(path: string): string {
  return resolveComponents(path, { hops: 0 })
}

const MAX_SYMLINK_HOPS = 40

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Walks an absolute, un-normalised path with lstat, following symlinks via
 * readlink even when the link target does not exist (a dangling link inside
 * cwd must still resolve to where it points). */
function resolveComponents(abs: string, budget: { hops: number }): string {
  const parts = abs.split(sep).filter((part) => part !== '' && part !== '.')
  let current: string = sep
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '..') {
      current = dirname(current)
      continue
    }
    const next = join(current, parts[i])
    let target: string | undefined
    try {
      if (lstatSync(next).isSymbolicLink()) target = readlinkSync(next)
    } catch (error) {
      if (!isMissing(error)) throw error
      // Missing component: nothing below it exists, so nothing further can be a
      // link. A later `..` could still climb back above it into an existing
      // symlink (`nope/../link/x`), and an adapter that normalises lexically
      // would follow that link, so refuse rather than collapse it.
      const rest = parts.slice(i + 1)
      if (rest.includes('..')) throw new Error('`..` after a missing path component')
      return resolve(next, ...rest)
    }
    if (target === undefined) {
      current = next
      continue
    }
    if (++budget.hops > MAX_SYMLINK_HOPS) throw new Error('too many symbolic links')
    const linked = isAbsolute(target) ? target : current + sep + target
    return resolveComponents([linked, ...parts.slice(i + 1)].join(sep), budget)
  }
  return current
}

/** True when `target` (absolute, relative to `cwd`, or a file: URI) resolves
 * inside `cwd` after symlinks and `..` are resolved. */
export function isInsideDirectory(target: string, cwd: string): boolean {
  let path = target
  if (/^file:/i.test(path)) {
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
  // A literal session-directory prefix may itself contain glob characters
  // (`Attention [2017] {v2}`); strip it before looking for a glob so they are
  // not mistaken for one. The remainder is resolved against the directory.
  const literalRoot = resolve(cwd)
  // Compare the raw string: normalising first would collapse `*/..` and hide it.
  if (path === literalRoot) path = '.'
  else if (path.startsWith(literalRoot + sep)) path = path.slice(literalRoot.length + 1)
  if (hasLeadingDotWildcard(path)) return false
  const globAt = path.search(/[*?[{]/)
  if (globAt >= 0) {
    const globPart = path.slice(globAt)
    if (globPart.includes('..') || GLOB_DOT_CLASS.test(globPart) || GLOB_ROOT_CLASS.test(globPart)) return false
    path = path.slice(0, globAt) || '.'
  }
  let root: string
  let real: string
  try {
    root = realResolve(literalRoot)
    // Raw concatenation: join/resolve would collapse `..` before symlinks are followed.
    real = realResolve(isAbsolute(path) ? path : root + sep + path)
  } catch {
    return false
  }
  const rel = relative(root, real)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Returns the reason a `read`/`search` request must be refused, or undefined. */
function scopeViolation(kind: string, req: RequestPermissionRequest, cwd: string | undefined): string | undefined {
  if (!PATH_SCOPED_KINDS.has(kind)) return undefined
  if (cwd === undefined) return 'no session directory to scope the request to'
  const rawInput = asRecord((req.toolCall as { rawInput?: unknown } | undefined)?.rawInput)
  const shapeError = rawInput ? vettedShapeError(rawInput) : undefined
  if (shapeError) return shapeError
  const targets = collectTargets(req)
  const outside = targets.find((target) => !isInsideDirectory(target, cwd))
  if (outside !== undefined) return 'path outside the session directory'
  const scan = scanLooseStrings((req.toolCall as { rawInput?: unknown } | undefined)?.rawInput)
  if (scan.truncated) return 'scan truncated'
  if (scan.strings.some((value) => looseValueEscapes(value, cwd))) return 'path outside the session directory'
  if (kind === 'read' && targets.length === 0) return 'no path determinable for read'
  if (kind === 'search' && looksRemote(req)) return 'search without a local path (web search)'
  if (kind === 'search' && targets.length === 0) {
    // Grep and Glob default their root to the session cwd, so a pattern with no
    // path searches inside it (an escaping glob already failed above). Anything
    // else must name a local path.
    const input = asRecord((req.toolCall as { rawInput?: unknown } | undefined)?.rawInput)
    if (typeof input?.pattern !== 'string' || input.pattern === '') return 'search names no path inside the session directory'
  }
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
      // One-shot grants only, for every kind: allow_always would persist a
      // blanket allow (`think` also covers Claude Agent/Task subagent tools),
      // so cancel when allow_once is absent.
      const allow = pickOption(options, ['allow_once'])
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
