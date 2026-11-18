import type { PermissionOption, RequestPermissionRequest, ToolKind } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'

import { ALLOWED_TOOL_KINDS, decidePermission } from './permission-policy.js'

const ALL_OPTIONS: PermissionOption[] = [
  { optionId: 'aa', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'ao', name: 'Allow', kind: 'allow_once' },
  { optionId: 'ra', name: 'Always reject', kind: 'reject_always' },
  { optionId: 'ro', name: 'Reject', kind: 'reject_once' },
]

function request(kind: ToolKind | undefined, options: PermissionOption[] = ALL_OPTIONS): RequestPermissionRequest {
  return { sessionId: 's', toolCall: { toolCallId: 't', title: 'tool', ...(kind ? { kind } : {}) }, options }
}

describe('decidePermission', () => {
  it.each(['read', 'search', 'think'] as const)('allows %s with a one-shot grant', (kind) => {
    const result = decidePermission(request(kind))
    expect(result.decision).toBe('allow')
    expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ao' })
  })

  it.each(['edit', 'delete', 'move', 'execute', 'switch_mode', 'other', 'fetch'] as const)(
    'rejects %s even though an allow option is offered',
    (kind) => {
      const result = decidePermission(request(kind))
      expect(result.decision).toBe('reject')
      expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ro' })
    },
  )

  it('rejects an absent kind', () => {
    expect(decidePermission(request(undefined)).decision).toBe('reject')
  })

  it('rejects a kind this client does not know', () => {
    const req = request('read')
    ;(req.toolCall as { kind: string }).kind = 'teleport'
    expect(decidePermission(req).decision).toBe('reject')
  })

  it('never selects an allow option for a denied kind', () => {
    for (const kind of ['edit', 'execute', 'delete', 'move'] as const) {
      const outcome = decidePermission(request(kind)).response.outcome
      expect(outcome.outcome === 'selected' ? outcome.optionId : undefined).not.toMatch(/^a/)
    }
  })

  it('falls back to reject_always when reject_once is missing', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind !== 'reject_once')
    expect(decidePermission(request('execute', options)).response.outcome).toEqual({ outcome: 'selected', optionId: 'ra' })
  })

  it('cancels a denied kind when the adapter offers only allow options', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind.startsWith('allow'))
    const result = decidePermission(request('edit', options))
    expect(result.decision).toBe('cancelled')
    expect(result.response.outcome).toEqual({ outcome: 'cancelled' })
  })

  it('cancels a denied kind when no options are offered', () => {
    expect(decidePermission(request('execute', [])).response.outcome).toEqual({ outcome: 'cancelled' })
  })

  it('uses allow_always for an allowed kind when allow_once is missing', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind !== 'allow_once')
    expect(decidePermission(request('read', options)).response.outcome).toEqual({ outcome: 'selected', optionId: 'aa' })
  })

  it('cancels an allowed kind when the adapter offers no allow option', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind.startsWith('reject'))
    expect(decidePermission(request('read', options)).response.outcome).toEqual({ outcome: 'cancelled' })
  })

  it('tolerates a request with no toolCall', () => {
    const req = { sessionId: 's', options: ALL_OPTIONS } as unknown as RequestPermissionRequest
    expect(decidePermission(req).decision).toBe('reject')
  })

  it('exposes only read-only kinds as allowed', () => {
    expect([...ALLOWED_TOOL_KINDS].sort()).toEqual(['read', 'search', 'think'])
  })
})
