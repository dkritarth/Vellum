import { join, resolve } from 'node:path'

interface RuntimeLocation {
  isPackaged: boolean
  userData: string
  cwd: string
  resourcesPath: string
  mainDirectory: string
}

/** Keep writable research state separate from installed application resources. */
export function resolveRuntimePaths(location: RuntimeLocation, env: NodeJS.ProcessEnv) {
  const override = env['VELLUM_DATA_DIR'] ?? env['VELLUM_DATA_ROOT']
  return {
    dataRoot: typeof override === 'string' && override.trim() !== ''
      ? resolve(location.cwd, override.trim())
      : location.isPackaged
        ? join(location.userData, 'data')
        : resolve(location.cwd, 'data'),
    nativeBinding: location.isPackaged
      ? join(location.resourcesPath, 'native', 'better_sqlite3.node')
      : resolve(location.mainDirectory, '../../resources/native/better_sqlite3.electron.node'),
  }
}
