import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function run(version: string, tag: string) {
  const root = mkdtempSync(join(tmpdir(), 'vellum-release-test-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  const output = join(root, 'output')
  const result = spawnSync(process.execPath, [resolve('scripts/release-metadata.mjs')], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag, GITHUB_OUTPUT: output },
  })
  return { ...result, output }
}
it('identifies v0 beta releases without promoting them to stable', () => {
  const result = run('0.1.1-beta.1', 'v0.1.1-beta.1')
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ version: '0.1.1-beta.1', tag: 'v0.1.1-beta.1', prerelease: true })
  expect(readFileSync(result.output, 'utf8')).toContain('prerelease=true\n')
})
it('rejects a tag/package mismatch before emitting release outputs', () => {
  const result = run('0.1.1-beta.1', 'v0.1.0')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('does not match package version')
  expect(existsSync(result.output)).toBe(false)
})
it('rejects malformed versions instead of injecting workflow outputs', () => {
  const result = run('0.1.1\nlatest=true', 'v0.1.1')
  expect(result.status).not.toBe(0)
  expect(existsSync(result.output)).toBe(false)
})
