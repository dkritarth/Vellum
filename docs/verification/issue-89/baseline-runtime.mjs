import { _electron as electron } from 'playwright'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve('test-artifacts/issue-89')
const cwd = join(root, 'baseline-cwd')
mkdirSync(cwd, { recursive: true })
const app = await electron.launch({
  executablePath: join(root, 'baseline-package/linux-unpacked/vellum'),
  args: ['--no-sandbox'],
  cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', VELLUM_DATA_DIR: '', VELLUM_DATA_ROOT: '',
    XDG_CONFIG_HOME: join(root, 'baseline-config'), XDG_CACHE_HOME: join(root, 'baseline-cache') },
})
try {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  assert.equal(await window.evaluate(() => window.vellum.ping()), 'pong')
  assert.deepEqual(await window.evaluate(() => window.vellum.listPapers()), [])
  const runtime = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'),
    isPackaged: app.isPackaged, cwd: process.cwd(), resourcesPath: process.resourcesPath }))
  assert.equal(existsSync(join(cwd, 'data/app.db')), true)
  writeFileSync(join(root, 'baseline-runtime.json'), JSON.stringify(runtime, null, 2))
  console.log('Baseline preload + SQLite passed; cwd/data/app.db reproduced.', runtime)
} finally { await app.close() }
