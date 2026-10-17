import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  let ready!: () => void
  const readyPromise = new Promise<void>((resolve) => { ready = resolve })
  return {
    ready,
    readyPromise,
    windows: [] as EventEmitter[],
    handlers: new Map<string, unknown>(),
    api: {} as Record<string, (...args: unknown[]) => unknown>,
    runHandlers: false,
    quit: vi.fn(),
    show: vi.fn(),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
  }
})

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const app = Object.assign(new EventEmitter(), {
    whenReady: () => electron.readyPromise,
    quit: electron.quit,
  })
  class BrowserWindow extends EventEmitter {
    constructor() {
      super()
      electron.windows.push(this)
    }
    static getAllWindows() { return electron.windows }
    show = electron.show
    loadFile = electron.loadFile
    loadURL = electron.loadURL
  }
  return {
    app,
    BrowserWindow,
    ipcMain: {
      handle: (channel: string, handler: unknown) => {
        if (electron.handlers.has(channel)) throw new Error(`Duplicate handler: ${channel}`)
        electron.handlers.set(channel, handler)
      },
    },
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]) => {
        const handler = electron.handlers.get(channel)
        if (typeof handler !== 'function') throw new Error(`No handler registered for '${channel}'`)
        if (electron.runHandlers) return handler({}, ...args)
      },
    },
    contextBridge: {
      exposeInMainWorld: (_name: string, api: typeof electron.api) => { electron.api = api },
    },
  }
})

import { app } from 'electron'
import { openDb } from '../core/store/db.js'

vi.mock('../core/store/db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/store/db.js')>()
  return { ...actual, openDb: vi.fn(() => actual.openDb({ path: ':memory:' })) }
})

describe('main process startup and preload contract', () => {
  beforeAll(async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    await import('./main.js')
    await import('./preload.js')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    for (const result of vi.mocked(openDb).mock.results) {
      if (result.type === 'return') result.value.close()
    }
  })

  it('opens and shows the workspace after readiness, recreates it on activation, and quits on close', async () => {
    expect(electron.windows).toHaveLength(0)
    electron.ready()
    await electron.readyPromise
    expect(electron.windows).toHaveLength(1)
    expect(electron.loadFile).toHaveBeenCalledWith(expect.stringContaining('/renderer/index.html'))
    expect(electron.show).not.toHaveBeenCalled()
    electron.windows[0]!.emit('ready-to-show')
    expect(electron.show).toHaveBeenCalledOnce()

    app.emit('activate')
    expect(electron.windows).toHaveLength(1)
    electron.windows.length = 0
    app.emit('activate')
    expect(electron.windows).toHaveLength(1)

    app.emit('window-all-closed')
    expect(electron.quit).toHaveBeenCalledTimes(process.platform === 'darwin' ? 0 : 1)
  })

  it('registers a main handler for every request advertised by the actual preload bridge', async () => {
    const requests = Object.entries(electron.api).filter(([name]) => name !== 'onAskUpdate')
    expect(requests.length).toBeGreaterThan(0)
    for (const [name, request] of requests) {
      await expect(Promise.resolve().then(() => request()), name).resolves.toBeUndefined()
    }
  })

  // These run before valid calls initialize main's cached database, so they
  // also prove malformed requests never open storage on first use.
  it.each([
    ['usageGetList', [{ sessionId: {} }], 'sessionId'],
    ['usageGetList', [{ limit: 1.5 }], 'limit'],
    ['usageGetList', [{ limit: 0 }], 'limit'],
    ['usageGetList', [{ backend: 'unknown' }], 'backend'],
    ['usageGetList', [[]], 'object'],
    ['collectionsCreate', [{ name: 'Child', parentId: '1' }], 'parentId'],
    ['collectionsRename', [{ id: 1.5, name: 'Renamed' }], 'id'],
    ['collectionsDelete', [Infinity], 'id'],
    ['collectionsAssign', [{ paperSlug: 'paper', collectionId: NaN }], 'collectionId'],
    ['collectionsAssign', [{ paperSlug: '../escape', collectionId: 1 }], 'slug'],
    ['collectionsRemove', [{ paperSlug: 'paper', collectionId: -1 }], 'collectionId'],
    ['listPapers', [{ collectionId: Number.MAX_SAFE_INTEGER + 1 }], 'collectionId'],
  ])('rejects malformed %s input before opening storage', async (method, args, field) => {
    electron.runHandlers = true
    vi.mocked(openDb).mockClear()
    try {
      await expect(Promise.resolve().then(() => electron.api[method]!(...args))).rejects.toThrow(field)
      expect(openDb).not.toHaveBeenCalled()
    } finally {
      electron.runHandlers = false
    }
  })

  it('preserves valid usage filters and collection operations through preload', async () => {
    electron.runHandlers = true
    try {
      await expect(electron.api['usageGetList']!()).resolves.toEqual([])
      await expect(electron.api['usageGetList']!({ backend: 'codex', sessionId: 1, limit: 10 })).resolves.toEqual([])
      const collection = await electron.api['collectionsCreate']!({ name: 'Research', parentId: null })
      expect(collection).toMatchObject({ id: 1, name: 'Research', parentId: null })
      await electron.api['collectionsRename']!({ id: 1, name: 'Reading' })
      await expect(electron.api['collectionsList']!()).resolves.toEqual([{ id: 1, name: 'Reading', parentId: null }])
      await expect(electron.api['listPapers']!({ collectionId: 1 })).resolves.toEqual([])
      await electron.api['collectionsDelete']!(1)
      await expect(electron.api['collectionsList']!()).resolves.toEqual([])
    } finally {
      electron.runHandlers = false
    }
  })
})
