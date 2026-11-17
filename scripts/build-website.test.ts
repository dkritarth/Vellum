import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(videos = true) {
  const root = mkdtempSync(join(tmpdir(), 'vellum-site-test-'))
  roots.push(root)
  mkdirSync(join(root, 'website'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.1-beta.1' }))
  writeFileSync(join(root, 'website/index.html'), '<a href="releases/__RELEASE_TAG__">__APP_VERSION__</a>')
  if (videos) {
    const evidence = join(root, 'docs/evidence/daily-workflow-2026-11-16')
    mkdirSync(evidence, { recursive: true })
    for (const name of ['walkthrough-1.webm', 'walkthrough-2.webm']) writeFileSync(join(evidence, name), 'video fixture')
  }
  return root
}
function run(root: string) {
  return spawnSync(process.execPath, [resolve('scripts/build-website.mjs')], { cwd: root, encoding: 'utf8' })
}
it('builds versioned download links and includes both local video assets', () => {
  const root = fixture()
  const result = run(root)
  expect(result.status).toBe(0)
  expect(readFileSync(join(root, 'site-dist/index.html'), 'utf8')).toBe('<a href="releases/v0.1.1-beta.1">0.1.1-beta.1</a>')
  expect(readFileSync(join(root, 'site-dist/assets/videos/walkthrough-2.webm'), 'utf8')).toBe('video fixture')
  expect(readFileSync(join(root, 'website/index.html'), 'utf8')).toContain('__RELEASE_TAG__')
})
it('fails rather than publishing a website with missing walkthrough assets', () => {
  const root = fixture(false)
  const result = run(root)
  expect(result.status).not.toBe(0)
  expect(existsSync(join(root, 'site-dist'))).toBe(false)
})
