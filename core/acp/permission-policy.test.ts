import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionOption, RequestPermissionRequest, ToolKind } from '@agentclientprotocol/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ALLOWED_TOOL_KINDS, decidePermission, isInsideDirectory } from './permission-policy.js'

let root: string
let cwd: string
let outside: string
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vellum-policy-')))
  cwd = join(root, 'paper')
  outside = join(root, 'secret')
  mkdirSync(cwd)
  mkdirSync(outside)
  writeFileSync(join(cwd, 'paper.md'), 'paper')
  writeFileSync(join(outside, 'key.txt'), 'secret')
  symlinkSync(outside, join(cwd, 'link-out'))
  symlinkSync(join(cwd, 'paper.md'), join(cwd, 'link-in'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ALL_OPTIONS: PermissionOption[] = [
  { optionId: 'aa', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'ao', name: 'Allow', kind: 'allow_once' },
  { optionId: 'ra', name: 'Always reject', kind: 'reject_always' },
  { optionId: 'ro', name: 'Reject', kind: 'reject_once' },
]

function request(kind: ToolKind | undefined, options: PermissionOption[] = ALL_OPTIONS, extra: Record<string, unknown> = {}): RequestPermissionRequest {
  return { sessionId: 's', toolCall: { toolCallId: 't', title: 'tool', ...(kind ? { kind } : {}), ...extra }, options }
}

/** A `read` request naming a file inside the session directory. */
function readOf(path: string, options: PermissionOption[] = ALL_OPTIONS): RequestPermissionRequest {
  return request('read', options, { locations: [{ path }] })
}

function decide(req: RequestPermissionRequest) {
  return decidePermission(req, { cwd })
}

describe('decidePermission', () => {
  it('allows think with no path, with a one-shot grant', () => {
    const result = decide(request('think'))
    expect(result.decision).toBe('allow')
    expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ao' })
  })

  it('allows a read of a file inside the session directory', () => {
    const result = decide(readOf(join(cwd, 'paper.md')))
    expect(result.decision).toBe('allow')
    expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ao' })
  })

  it('allows a search whose path is the session directory, and a path-less local search', () => {
    expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: 'attention', path: cwd } })).decision).toBe('allow')
    expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: 'attention' } })).decision).toBe('allow')
    expect(decide(request('search', ALL_OPTIONS, { locations: [{ path: join(cwd, 'paper.md') }] })).decision).toBe('allow')
  })

  describe('read/search are scoped to the session directory', () => {
    it.each([
      ['an absolute path outside', () => join(outside, 'key.txt')],
      ['a ../ traversal', () => join(cwd, '..', 'secret', 'key.txt')],
      ['a relative ../ traversal', () => '../secret/key.txt'],
      ['a symlink that leaves the directory', () => join(cwd, 'link-out', 'key.txt')],
      ['a home-relative path', () => '~/.ssh/id_rsa'],
      ['a sibling with the same prefix', () => `${cwd}-evil/paper.md`],
      ['a file URI outside', () => `file://${join(outside, 'key.txt')}`],
      ['a url', () => 'https://example.com/x'],
      ['/etc/passwd', () => '/etc/passwd'],
    ])('rejects a read of %s', (_name, target) => {
      const result = decide(readOf(target()))
      expect(result.decision).toBe('reject')
      expect(result.reason).toBe('path outside the session directory')
      expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ro' })
    })

    it('allows a symlink that stays inside, a relative path and a file URI inside', () => {
      expect(decide(readOf(join(cwd, 'link-in'))).decision).toBe('allow')
      expect(decide(readOf('paper.md')).decision).toBe('allow')
      expect(decide(readOf(`file://${join(cwd, 'paper.md')}`)).decision).toBe('allow')
    })

    it('allows a not-yet-existing file inside the directory', () => {
      expect(decide(readOf(join(cwd, 'new', 'notes.md'))).decision).toBe('allow')
    })

    it('rejects a not-yet-existing file reached through a symlink out', () => {
      expect(decide(readOf(join(cwd, 'link-out', 'new.md'))).decision).toBe('reject')
    })

    it.each(['path', 'file_path', 'filePath', 'notebook_path', 'directory', 'uri'])('rejects an outside rawInput.%s', (key) => {
      const value = key === 'uri' ? `file://${outside}/key.txt` : join(outside, 'key.txt')
      expect(decide(request('read', ALL_OPTIONS, { rawInput: { [key]: value } })).decision).toBe('reject')
    })

    it('rejects when any one of several paths is outside', () => {
      const req = request('read', ALL_OPTIONS, { locations: [{ path: join(cwd, 'paper.md') }, { path: join(outside, 'key.txt') }] })
      expect(decide(req).decision).toBe('reject')
      expect(decide(request('read', ALL_OPTIONS, { rawInput: { paths: [join(cwd, 'paper.md'), '/etc/passwd'] } })).decision).toBe('reject')
    })

    it('rejects a read with no determinable path', () => {
      for (const extra of [{}, { locations: [] }, { rawInput: {} }, { rawInput: 'cat paper.md' }, { locations: [{}] }, { rawInput: { path: '  ' } }]) {
        const result = decide(request('read', ALL_OPTIONS, extra))
        expect(result.decision).toBe('reject')
        expect(result.reason).toBe('no path determinable for read')
      }
    })

    it('rejects a search outside the directory and a glob that escapes it', () => {
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: 'x', path: '/etc' } })).decision).toBe('reject')
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: '../../**/*.pem' } })).decision).toBe('reject')
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: '/home/**/id_rsa', path: cwd } })).decision).toBe('reject')
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { glob: `${outside}/**` } })).decision).toBe('reject')
    })

    it('allows a glob that stays inside', () => {
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: `${cwd}/**/*.md` } })).decision).toBe('allow')
    })

    it('rejects a web search (search kind with no local path)', () => {
      const web = request('search', ALL_OPTIONS, { rawInput: { type: 'webSearch', id: 'w', query: 'secret from paper', action: null } })
      const result = decide(web)
      expect(result.decision).toBe('reject')
      expect(result.reason).toBe('search without a local path (web search)')
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { query: 'x' } })).decision).toBe('reject')
    })

    it('rejects read and search when the policy has no session directory', () => {
      expect(decidePermission(readOf(join(cwd, 'paper.md')), {}).decision).toBe('reject')
      expect(decidePermission(request('think'), {}).decision).toBe('allow')
    })
  })

  it.each(['edit', 'delete', 'move', 'execute', 'switch_mode', 'other', 'fetch'] as const)(
    'rejects %s even though an allow option is offered',
    (kind) => {
      const result = decide(request(kind))
      expect(result.decision).toBe('reject')
      expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ro' })
    },
  )

  it('rejects a null kind', () => {
    const req = request('read', ALL_OPTIONS, { locations: [{ path: join(cwd, 'paper.md') }] })
    ;(req.toolCall as { kind: unknown }).kind = null
    const result = decide(req)
    expect(result.decision).toBe('reject')
    expect(result.kind).toBeUndefined()
    expect(result.response.outcome).toEqual({ outcome: 'selected', optionId: 'ro' })
  })

  it('rejects an absent kind', () => {
    expect(decide(request(undefined)).decision).toBe('reject')
  })

  it('rejects a kind this client does not know', () => {
    const req = request('read')
    ;(req.toolCall as { kind: string }).kind = 'teleport'
    expect(decidePermission(req).decision).toBe('reject')
  })

  it('never selects an allow option for a denied kind', () => {
    for (const kind of ['edit', 'execute', 'delete', 'move'] as const) {
      const outcome = decide(request(kind)).response.outcome
      expect(outcome.outcome === 'selected' ? outcome.optionId : undefined).not.toMatch(/^a/)
    }
  })

  it('falls back to reject_always when reject_once is missing', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind !== 'reject_once')
    expect(decide(request('execute', options)).response.outcome).toEqual({ outcome: 'selected', optionId: 'ra' })
  })

  it('cancels a denied kind when the adapter offers only allow options', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind.startsWith('allow'))
    const result = decide(request('edit', options))
    expect(result.decision).toBe('cancelled')
    expect(result.response.outcome).toEqual({ outcome: 'cancelled' })
  })

  it('cancels a denied kind when no options are offered', () => {
    expect(decide(request('execute', [])).response.outcome).toEqual({ outcome: 'cancelled' })
  })

  it('uses allow_always for an allowed kind when allow_once is missing', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind !== 'allow_once')
    expect(decide(readOf(join(cwd, 'paper.md'), options)).response.outcome).toEqual({ outcome: 'selected', optionId: 'aa' })
  })

  it('cancels an allowed kind when the adapter offers no allow option', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind.startsWith('reject'))
    expect(decide(readOf(join(cwd, 'paper.md'), options)).response.outcome).toEqual({ outcome: 'cancelled' })
  })

  it('tolerates a request with no toolCall', () => {
    const req = { sessionId: 's', options: ALL_OPTIONS } as unknown as RequestPermissionRequest
    expect(decide(req).decision).toBe('reject')
  })

  it('exposes only read-only kinds as allowed', () => {
    expect([...ALLOWED_TOOL_KINDS].sort()).toEqual(['read', 'search', 'think'])
  })
})

describe('isInsideDirectory', () => {
  it('treats the directory itself as inside', () => {
    expect(isInsideDirectory(cwd, cwd)).toBe(true)
    expect(isInsideDirectory('.', cwd)).toBe(true)
  })

  it('rejects the parent directory', () => {
    expect(isInsideDirectory(root, cwd)).toBe(false)
    expect(isInsideDirectory('..', cwd)).toBe(false)
  })
})
