import { describe, expect, it } from 'vitest'

import { mergeLoginShellPath } from './shell-path'

const wrap = (path: string) => `motd banner\n__VELLUM_PATH__${path}__VELLUM_PATH__`

describe('mergeLoginShellPath', () => {
  it('appends login-shell directories the app PATH lacks, keeping order', () => {
    const merged = mergeLoginShellPath(
      '/usr/bin:/bin',
      { SHELL: '/bin/zsh' },
      () => wrap('/opt/homebrew/bin:/usr/bin:/Users/me/.npm-global/bin'),
    )
    expect(merged).toBe('/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.npm-global/bin')
  })

  it('runs the user shell as an interactive login shell', () => {
    let call: [string, string[]] | undefined
    mergeLoginShellPath('/usr/bin', { SHELL: '/bin/bash' }, (shell, args) => {
      call = [shell, args]
      return wrap('/usr/bin')
    })
    expect(call?.[0]).toBe('/bin/bash')
    expect(call?.[1].slice(0, 1)).toEqual(['-ilc'])
  })

  it('keeps the current PATH when the shell fails or prints no marker', () => {
    expect(mergeLoginShellPath('/usr/bin', {}, () => { throw new Error('timeout') })).toBe('/usr/bin')
    expect(mergeLoginShellPath('/usr/bin', {}, () => '/opt/homebrew/bin')).toBe('/usr/bin')
  })
})
