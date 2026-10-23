import { describe, expect, it } from 'vitest'
import { resolveRuntimePaths } from './paths.js'

const packaged = {
  isPackaged: true,
  userData: '/home/researcher/.config/vellum',
  cwd: '/foreign/launch',
  resourcesPath: '/opt/vellum/resources',
  mainDirectory: '/opt/vellum/resources/app.asar/out/main',
}

describe('runtime paths', () => {
  it('keeps packaged state and native resources independent of the launch directory', () => {
    const paths = resolveRuntimePaths(packaged, {})
    expect(paths.dataRoot).toBe('/home/researcher/.config/vellum/data')
    expect(paths.nativeBinding).toBe('/opt/vellum/resources/native/better_sqlite3.node')
    expect(resolveRuntimePaths({ ...packaged, cwd: '/another/launch' }, {})).toEqual(paths)
  })

  it('preserves explicit data overrides in both packaged and source runs', () => {
    for (const isPackaged of [true, false]) {
      const location = { ...packaged, isPackaged }
      expect(resolveRuntimePaths(location, {
        VELLUM_DATA_DIR: ' /scratch/research ',
        VELLUM_DATA_ROOT: '/legacy',
      }).dataRoot).toBe('/scratch/research')
      expect(resolveRuntimePaths(location, { VELLUM_DATA_DIR: 'relative-data' }).dataRoot)
        .toBe('/foreign/launch/relative-data')
      expect(resolveRuntimePaths(location, { VELLUM_DATA_ROOT: '/legacy' }).dataRoot)
        .toBe('/legacy')
      expect(resolveRuntimePaths(location, { VELLUM_DATA_DIR: '   ' }).dataRoot)
        .toBe(isPackaged ? '/home/researcher/.config/vellum/data' : '/foreign/launch/data')
    }
  })

  it('preserves source data and Electron binding paths', () => {
    expect(resolveRuntimePaths({
      ...packaged,
      isPackaged: false,
      cwd: '/checkout',
      mainDirectory: '/checkout/out/main',
    }, {})).toEqual({
      dataRoot: '/checkout/data',
      nativeBinding: '/checkout/resources/native/better_sqlite3.electron.node',
    })
  })
})
