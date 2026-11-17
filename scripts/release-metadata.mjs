// Shared release identity for packaging, Pages, and tag validation.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function releaseMetadata(root = process.cwd(), env = process.env) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error('Invalid package release version')
  }
  const tag = `v${version}`
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME !== tag) {
    throw new Error(`Tag ${env.GITHUB_REF_NAME} does not match package version ${version}`)
  }
  return { version, tag, prerelease: version.startsWith('0.') || version.includes('-') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const metadata = releaseMetadata()
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''))
  }
  console.log(JSON.stringify(metadata))
}
