import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const config = resolve('vitest.config.ts')
const runner = resolve('node_modules/vitest/vitest.mjs')

it.each([{ filters: [] }, { filters: ['sentinel'] }])(
  'runs only current-checkout tests with filters $filters',
  async ({ filters }) => {
    const temporary = await mkdtemp(join(tmpdir(), 'vellum-discovery-'))
    // An ancestor worktree must not hide the current checkout's own tests.
    const root = join(temporary, '.claude/worktrees/current')
    const report = join(temporary, 'results.json')
    const legitimate = [
      'sentinel.config.test.ts',
      'core/sentinel.test.ts',
      'electron/sentinel.test.ts',
      'src/sentinel.test.ts',
      'future-module/sentinel.test.ts',
    ]
    const excluded = [
      '.claude/worktrees/agent/core/sentinel.test.ts',
      'tools/.claude/worktrees/agent/src/sentinel.test.ts',
      'node_modules/ignored/sentinel.test.ts',
      'dist/sentinel.test.ts',
    ]

    try {
      for (const file of [...legitimate, ...excluded]) {
        const target = join(root, file)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(
          target,
          `import { it, expect } from 'vitest'\nit('sentinel', () => expect(${legitimate.includes(file)}).toBe(true))\n`,
        )
      }
      // Resolve the real installed runner without installing fixture dependencies.
      await symlink(resolve('node_modules/vitest'), join(root, 'node_modules/vitest'), 'dir')
      const result = await execFileAsync(process.execPath, [
        runner, 'run', ...filters, '--root', root, '--config', config,
        '--reporter=json', '--outputFile', report, '--no-cache',
        '--maxWorkers=1', '--minWorkers=1',
      ], { cwd: root, timeout: 20_000 }).then(
        () => ({ code: 0, output: '' }),
        (error: Error & { code: number; stdout: string; stderr: string }) => ({
          code: error.code,
          output: `${error.stdout}\n${error.stderr}`,
        }),
      )
      const results = JSON.parse(await readFile(report, 'utf8')) as {
        numPassedTests: number
        testResults: { name: string }[]
      }
      expect(results.testResults.map(({ name }) => name).sort()).toEqual(
        legitimate.map((file) => join(root, file)).sort(),
      )
      expect(result.code, result.output).toBe(0)
      expect(results.numPassedTests).toBe(legitimate.length)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  },
  30_000,
)
