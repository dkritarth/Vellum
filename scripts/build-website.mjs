// Stage the static website and existing recordings without tracking duplicate videos.
import fs from 'node:fs'
import path from 'node:path'
import { releaseMetadata } from './release-metadata.mjs'

const root = process.cwd()
const output = path.join(root, 'site-dist')
const source = path.join(root, 'website')
const evidence = path.join(root, 'docs/evidence/daily-workflow-2026-11-16')
const videos = ['walkthrough-1.webm', 'walkthrough-2.webm']
const { version, tag } = releaseMetadata(root)
for (const file of videos) {
  if (!fs.existsSync(path.join(evidence, file))) throw new Error(`Missing walkthrough asset: ${file}`)
}
const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
  .replaceAll('__RELEASE_TAG__', tag).replaceAll('__APP_VERSION__', version)
if (/__[A-Z_]+__/.test(html)) throw new Error('Unresolved website template value')
fs.rmSync(output, { recursive: true, force: true })
fs.cpSync(source, output, { recursive: true })
fs.writeFileSync(path.join(output, 'index.html'), html)
fs.mkdirSync(path.join(output, 'assets/videos'), { recursive: true })
for (const file of videos) fs.copyFileSync(path.join(evidence, file), path.join(output, 'assets/videos', file))
console.log(`Website staged in site-dist for ${tag}`)
