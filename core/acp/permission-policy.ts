// Deny-by-default policy for ACP `session/request_permission`.
//
// Vellum agents read paper.md, which is extracted from arbitrary PDFs and
// arXiv downloads, so its text is untrusted: a hidden "run this command"
// instruction must not be able to obtain edit or execute permission. Vellum
// has no permission prompt UI yet, so the client grants only tool kinds that
// cannot change the machine or send data off it, and refuses everything else.
import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'

/** Tool kinds that only observe local state. `fetch` is deliberately absent:
 * it reaches the network, so injected paper text could use it to exfiltrate
 * the paper or other local content, and grounding never needs it. */
export const ALLOWED_TOOL_KINDS: ReadonlySet<string> = new Set(['read', 'search', 'think'])

export interface PermissionDecision {
  response: RequestPermissionResponse
  /** Raw `toolCall.kind` the adapter reported, or `undefined` when absent. */
  kind: string | undefined
  title: string | undefined
  decision: 'allow' | 'reject' | 'cancelled'
  optionId?: string
}

function pickOption(options: PermissionOption[], kinds: PermissionOption['kind'][]): PermissionOption | undefined {
  for (const kind of kinds) {
    const match = options.find((option) => option.kind === kind)
    if (match) return match
  }
  return undefined
}

export function decidePermission(req: RequestPermissionRequest): PermissionDecision {
  const kind = typeof req.toolCall?.kind === 'string' ? req.toolCall.kind : undefined
  const title = typeof req.toolCall?.title === 'string' ? req.toolCall.title : undefined
  const options = Array.isArray(req.options) ? req.options : []

  if (kind !== undefined && ALLOWED_TOOL_KINDS.has(kind)) {
    // Prefer one-shot grants so approving a read never persists a blanket allow.
    const allow = pickOption(options, ['allow_once', 'allow_always'])
    if (allow) {
      return { response: { outcome: { outcome: 'selected', optionId: allow.optionId } }, kind, title, decision: 'allow', optionId: allow.optionId }
    }
    return { response: { outcome: { outcome: 'cancelled' } }, kind, title, decision: 'cancelled' }
  }

  // reject_once keeps a refusal scoped to this call; reject_always would
  // silently pre-refuse later calls the user may want, but is still a refusal.
  const reject = pickOption(options, ['reject_once', 'reject_always'])
  if (reject) {
    return { response: { outcome: { outcome: 'selected', optionId: reject.optionId } }, kind, title, decision: 'reject', optionId: reject.optionId }
  }
  return { response: { outcome: { outcome: 'cancelled' } }, kind, title, decision: 'cancelled' }
}
