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
  // link -> <root>/outside/sub: lexically `link/..` is the paper dir, really `<root>/outside`. (Build such paths by string concat: path.join collapses `..`.)
  mkdirSync(join(root, 'outside', 'sub'), { recursive: true })
  writeFileSync(join(root, 'outside', 'secret.txt'), 'secret')
  symlinkSync(join(root, 'outside', 'sub'), join(cwd, 'link'))
  writeFileSync(join(cwd, 'secret.txt'), 'inside copy')
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

  it('allows a search that names a path inside the session directory', () => {
    expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: 'attention', path: cwd } })).decision).toBe('allow')
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

    it('rejects globs that climb out through ..', () => {
      const patterns = ['*/../../../../etc/*', '**/../../../../etc/passwd', '{a,..}/{a,..}/{a,..}/etc/passwd', '[.][.]/[.][.]/etc/passwd', '*/[.][.]/*', '?/../x']
      for (const pattern of patterns) {
        expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern } })).decision, `pattern ${pattern}`).toBe('reject')
        expect(decide(request('search', ALL_OPTIONS, { rawInput: { glob: pattern, path: cwd } })).decision, `glob ${pattern}`).toBe('reject')
        expect(decide(request('read', ALL_OPTIONS, { locations: [{ path: `${cwd}/${pattern}` }] })).decision, `location ${pattern}`).toBe('reject')
      }
    })

    it('rejects the reproduced probes', () => {
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: '*/../../../../etc/*' } })).decision).toBe('reject')
      expect(decide(request('read', ALL_OPTIONS, { locations: [{ path: join(cwd, '*/../../../../etc/passwd') }] })).decision).toBe('reject')
    })

    it('rejects a dangling symlink inside the directory that points outside', () => {
      symlinkSync(join(outside, 'missing.txt'), join(cwd, 'dangling'))
      symlinkSync(join(outside, 'no-such-dir'), join(cwd, 'dangling-dir'))
      expect(decide(readOf(join(cwd, 'dangling'))).decision).toBe('reject')
      expect(decide(readOf(join(cwd, 'dangling-dir', 'x.txt'))).decision).toBe('reject')
    })

    it('allows a dangling symlink that points inside', () => {
      symlinkSync(join(cwd, 'not-yet.md'), join(cwd, 'dangling-in'))
      expect(decide(readOf(join(cwd, 'dangling-in'))).decision).toBe('allow')
    })

    it('rejects a symlink loop without hanging', () => {
      symlinkSync(join(cwd, 'loop-b'), join(cwd, 'loop-a'))
      symlinkSync(join(cwd, 'loop-a'), join(cwd, 'loop-b'))
      expect(typeof decide(readOf(join(cwd, 'loop-a'))).decision).toBe('string')
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

    it('default-denies a search that names no path inside the directory', () => {
      for (const rawInput of [{ q: 'secret' }, { term: 'x' }, {}, { text: 'a b' }]) {
        const result = decide(request('search', ALL_OPTIONS, { rawInput }))
        expect(result.decision, JSON.stringify(rawInput)).toBe('reject')
      }
      expect(decide(request('search', ALL_OPTIONS)).decision).toBe('reject')
    })

    it('rejects any rawInput string value that looks like a path outside the directory, under any key', () => {
      const bad = ['/etc/passwd', '~/.ssh/id_rsa', 'file:///etc/passwd', 'file:/etc/passwd', 'FILE:/etc/passwd', '../secret/key.txt', 'a/../../secret', '..\\secret', outside, 'https://example.com/x']
      for (const value of bad) {
        for (const kind of ['read', 'search'] as const) {
          const locations = [{ path: join(cwd, 'paper.md') }]
          expect(decide(request(kind, ALL_OPTIONS, { locations, rawInput: { source: value } })).decision, `${kind} source ${value}`).toBe('reject')
          expect(decide(request(kind, ALL_OPTIONS, { locations, rawInput: { nested: { deep: [{ x: value }] } } })).decision, `${kind} nested ${value}`).toBe('reject')
          expect(decide(request(kind, ALL_OPTIONS, { locations, rawInput: { cmd: `cat ${value}` } })).decision, `${kind} token ${value}`).toBe('reject')
        }
      }
    })

    it('still allows in-directory strings under unknown keys', () => {
      const locations = [{ path: join(cwd, 'paper.md') }]
      expect(decide(request('read', ALL_OPTIONS, { locations, rawInput: { source: join(cwd, 'paper.md'), note: 'attention is all', n: 3 } })).decision).toBe('allow')
      expect(decide(request('search', ALL_OPTIONS, { locations, rawInput: { pattern: 'a..b', other: 'file.name' } })).decision).toBe('allow')
    })

    it('treats a single-slash file: path as a URI', () => {
      expect(decide(readOf('file:/etc/passwd')).decision).toBe('reject')
      expect(decide(readOf(`file:${join(outside, 'key.txt')}`)).decision).toBe('reject')
      expect(isInsideDirectory('file:/etc/passwd', cwd)).toBe(false)
    })

    it('rejects globs with a leading-dot wildcard component', () => {
      for (const pattern of ['.*/x', '.?/x', '.*/../x', 'a/.*/b', '.?*/etc']) {
        expect(decide(request('search', ALL_OPTIONS, { rawInput: { glob: pattern, path: cwd } })).decision, `glob ${pattern}`).toBe('reject')
        expect(decide(request('read', ALL_OPTIONS, { locations: [{ path: `${cwd}/${pattern}` }] })).decision, `location ${pattern}`).toBe('reject')
      }
      expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: '.*foo', path: cwd } })).decision).toBe('allow')
    })

    describe('round 4', () => {
      const grep = (rawInput: Record<string, unknown>, title = 'grep "x"') => request('search', ALL_OPTIONS, { title, rawInput })
      const glob = (rawInput: Record<string, unknown>) => request('search', ALL_OPTIONS, { title: 'Find `x`', rawInput })

      it('rejects (fails closed) when the string scan hits its depth bound', () => {
        let deep: unknown = '/etc/passwd'
        for (let i = 0; i < 9; i++) deep = { n: deep }
        const result = decide(request('read', ALL_OPTIONS, { rawInput: { file_path: 'paper.md', d: deep } }))
        expect(result.decision).toBe('reject')
        expect(result.reason).toBe('scan truncated')
      })

      it('rejects (fails closed) when the string scan hits its count bound', () => {
        const wide = Array.from({ length: 501 }, (_, i) => (i === 500 ? '/etc/passwd' : 'x'))
        const result = decide(request('read', ALL_OPTIONS, { rawInput: { file_path: 'paper.md', w: wide } }))
        expect(result.decision).toBe('reject')
        expect(result.reason).toBe('scan truncated')
      })

      it('allows nesting and counts just under the bounds', () => {
        let ok: unknown = 'x'
        for (let i = 0; i < 7; i++) ok = { n: ok }
        expect(decide(request('read', ALL_OPTIONS, { rawInput: { file_path: 'paper.md', d: ok, w: Array.from({ length: 400 }, () => 'x') } })).decision).toBe('allow')
      })

      it.each(['https://arxiv.org', '/Introduction/', 'a/b', '..', '\\.\\./', 'Section 3.2', 'e.g. ~5%', '~', 'x,/etc/passwd', '/etc/passwd'])(
        'allows Grep regex %s as pattern',
        (pattern) => {
          expect(decide(grep({ pattern, path: cwd })).decision, pattern).toBe('allow')
          expect(decide(grep({ pattern })).decision, `no path ${pattern}`).toBe('allow')
        },
      )

      it('still rejects a Grep glob filter that escapes', () => {
        expect(decide(grep({ pattern: 'x', glob: '../../**/*.pem', path: cwd })).decision).toBe('reject')
        expect(decide(grep({ pattern: 'x', glob: '*.md', path: cwd })).decision).toBe('allow')
      })

      it('treats a Grep/Glob with no path as the session directory', () => {
        expect(decide(grep({ pattern: 'Attention' })).decision).toBe('allow')
        expect(decide(glob({ pattern: '**/*.md' })).decision).toBe('allow')
        expect(decide(glob({ pattern: '../../**/*.pem' })).decision).toBe('reject')
        expect(decide(glob({ pattern: '/home/**/id_rsa' })).decision).toBe('reject')
        expect(decide(glob({ pattern: '*/../../etc/*' })).decision).toBe('reject')
        expect(decide(grep({ pattern: 'x', path: '/etc' })).decision).toBe('reject')
      })

      it('does not allow a path-less search that looks remote', () => {
        expect(decide(grep({ pattern: 'x', query: 'y' })).decision).toBe('reject')
        expect(decide(request('search', ALL_OPTIONS, { rawInput: { type: 'webSearch', pattern: 'x' } })).decision).toBe('reject')
      })

      it.each(['x,/etc/passwd', 'a;/etc/passwd', 'k:/etc/passwd', 'k=/etc/passwd', '"/etc/passwd"', "'/etc/passwd'", '(/etc/passwd)', '[/etc/passwd]', '{/etc/passwd}', 'a|/etc/passwd', 'x,~/.ssh/id_rsa', 'x,../secret', '..', 'x,https://e.com/a'])(
        'rejects an outside path hidden in an unknown key via %s',
        (note) => {
          expect(decide(request('read', ALL_OPTIONS, { locations: [{ path: join(cwd, 'paper.md') }], rawInput: { note } })).decision, note).toBe('reject')
        },
      )

      it('does not reject ordinary prose in unknown keys', () => {
        for (const note of ['e.g. ~5% of 3.2/4 and so..', 'see Section 3, p. 4; ok: yes', 'a/b and c/d', 'x ... y']) {
          expect(decide(request('read', ALL_OPTIONS, { locations: [{ path: join(cwd, 'paper.md') }], rawInput: { note } })).decision, note).toBe('allow')
        }
      })
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

  it('never selects allow_always for any kind: cancels when allow_once is missing', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind !== 'allow_once')
    const decision = decide(request('think', options))
    expect(decision.response.outcome).toEqual({ outcome: 'cancelled' })
    expect(decision.decision).toBe('cancelled')
  })

  it('never selects allow_always for read or search: cancels when allow_once is missing', () => {
    const options = ALL_OPTIONS.filter((o) => o.kind !== 'allow_once')
    expect(decide(readOf(join(cwd, 'paper.md'), options)).response.outcome).toEqual({ outcome: 'cancelled' })
    const search = request('search', options, { rawInput: { pattern: 'x', path: cwd } })
    expect(decide(search).response.outcome).toEqual({ outcome: 'cancelled' })
    expect(decide(search).decision).toBe('cancelled')
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

describe('decidePermission round-5 review cases', () => {
  const decide = (kind: ToolKind, extra: Record<string, unknown>) => decidePermission(request(kind, ALL_OPTIONS, extra), { cwd }).decision

  it('glob-checks a Glob pattern even when a Grep-only key is added', () => {
    expect(decide('search', { title: 'Find `../../**`', rawInput: { pattern: '../../**', output_mode: 'files_with_matches' } })).toBe('reject')
  })

  it('still treats a grep-titled pattern as a regex', () => {
    expect(decide('search', { title: 'grep "https://arxiv.org"', rawInput: { pattern: 'https://arxiv.org' } })).toBe('allow')
  })

  it.each([
    { path: ['/etc'] },
    { file_path: ['/etc/passwd'] },
    { pattern: ['../**'] },
    { glob: ['../**'] },
    { path: { nested: '/etc' } },
    { path: 42 },
    { paths: '/etc' },
    { paths: [['/etc']] },
  ])('rejects a non-string value under a vetted key: %j', (rawInput) => {
    expect(decide('search', { title: 'Find', rawInput: { pattern: '*.md', ...rawInput } })).toBe('reject')
  })

  it.each(['{/etc,x}/*', '[/]etc/*', '{/etc}/passwd', '{~,x}/.ssh/*'])('rejects a glob whose group expands to an absolute or home path: %s', (pattern) => {
    expect(decide('search', { title: 'Find', rawInput: { pattern } })).toBe('reject')
  })

  it('rejects a glob whose fixed prefix passes through a symlink out of the directory', () => {
    expect(decide('search', { title: 'Find', rawInput: { pattern: 'link-out/*' } })).toBe('reject')
    expect(decide('search', { title: 'grep x', rawInput: { pattern: 'x', glob: 'link-out/*.txt' } })).toBe('reject')
  })

  it('rejects a search whose nested input looks remote', () => {
    expect(decide('search', { title: 'search', rawInput: { pattern: 'x', action: { type: 'search', query: 'q' } } })).toBe('reject')
  })

  it('allows reads under a session directory whose name has glob characters', () => {
    const odd = join(root, 'Attention [2017] {v2} *x')
    mkdirSync(odd, { recursive: true })
    writeFileSync(join(odd, 'paper.md'), 'paper')
    const req = request('read', ALL_OPTIONS, { locations: [{ path: join(odd, 'paper.md') }] })
    expect(decidePermission(req, { cwd: odd }).decision).toBe('allow')
    const escape = request('read', ALL_OPTIONS, { locations: [{ path: join(odd, '..', 'secret', 'key.txt') }] })
    expect(decidePermission(escape, { cwd: odd }).decision).toBe('reject')
  })
})

describe('symlink followed before ..', () => {
  it('rejects read and search of link/../secret.txt (OS reads outside/secret.txt)', () => {
    expect(decide(readOf(`${cwd}/link/../secret.txt`)).decision).toBe('reject')
    expect(decide(request('read', ALL_OPTIONS, { rawInput: { file_path: 'link/../secret.txt' } })).decision).toBe('reject')
    expect(decide(request('search', ALL_OPTIONS, { rawInput: { pattern: 'x', path: `${cwd}/link/../secret.txt` } })).decision).toBe('reject')
  })

  it('rejects the glob form link/../*', () => {
    expect(decide(request('search', ALL_OPTIONS, { title: 'Find', rawInput: { pattern: `${cwd}/link/../*` } })).decision).toBe('reject')
    expect(decide(request('search', ALL_OPTIONS, { title: 'Find', rawInput: { pattern: 'link/../*' } })).decision).toBe('reject')
  })

  it('still allows .. that stays on real directories inside the session directory', () => {
    mkdirSync(join(cwd, 'real'), { recursive: true })
    expect(decide(readOf(`${cwd}/real/../paper.md`)).decision).toBe('allow')
    expect(isInsideDirectory('link-in', cwd)).toBe(true)
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
