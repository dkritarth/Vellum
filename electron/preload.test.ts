import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VellumApi } from './preload'

const { exposeInMainWorld, invoke, getPathForFile } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  getPathForFile: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke },
  webUtils: { getPathForFile },
}))

let api: VellumApi
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  await import('./preload')
  expect(exposeInMainWorld).toHaveBeenCalledWith('vellum', expect.any(Object))
  api = exposeInMainWorld.mock.calls[0][1] as VellumApi
})

describe('preload file path resolver', () => {
  it.each(['/home/research/论文/Attention paper.pdf', ''])('returns native result %j without sending File through IPC', (path) => {
    const file = new File(['pdf'], 'Attention paper.pdf')
    getPathForFile.mockReturnValue(path)
    expect(api.getPathForFile(file)).toBe(path)
    expect(getPathForFile).toHaveBeenCalledTimes(1)
    expect(getPathForFile).toHaveBeenCalledWith(file)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('preserves native validation errors without invoking main IPC', () => {
    const invalid = {} as File
    getPathForFile.mockImplementation(() => { throw new TypeError('Expected a File') })
    expect(() => api.getPathForFile(invalid)).toThrow('Expected a File')
    expect(invoke).not.toHaveBeenCalled()
  })
})
