// Packaged apps launched from Finder or a desktop launcher inherit a minimal
// PATH (/usr/bin:/bin:/usr/sbin:/sbin on macOS). ACP adapters such as
// codex-acp and claude-agent-acp are usually installed by npm or Homebrew
// under directories only the user's login shell adds, so without this the
// app reports every backend as missing. Ask the login shell for its PATH once
// at startup and append whatever directories the app does not already have.

import { execFileSync } from 'node:child_process'
import { delimiter } from 'node:path'

const MARKER = '__VELLUM_PATH__'

export type RunShell = (shell: string, args: string[]) => string

const defaultRunShell: RunShell = (shell, args) =>
  execFileSync(shell, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })

/** Return `current` with any login-shell PATH entries it lacks appended. */
export function mergeLoginShellPath(
  current: string | undefined,
  env: NodeJS.ProcessEnv,
  runShell: RunShell = defaultRunShell,
): string | undefined {
  const shell = env.SHELL?.trim() || '/bin/zsh'
  let output: string
  try {
    output = runShell(shell, ['-ilc', `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`])
  } catch {
    return current
  }
  // Login shells may print banners; only trust the text between the markers.
  const match = output.match(new RegExp(`${MARKER}(.*?)${MARKER}`, 's'))
  if (!match) return current
  const existing = (current ?? '').split(delimiter).filter(Boolean)
  const seen = new Set(existing)
  const added = match[1].split(delimiter).filter((dir) => dir && !seen.has(dir) && seen.add(dir))
  if (added.length === 0) return current
  return [...existing, ...added].join(delimiter)
}
