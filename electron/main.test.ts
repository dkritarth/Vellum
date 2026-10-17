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
    api: {} as Record<string, () => unknown>,
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
      invoke: async (channel: string) => {
        if (!electron.handlers.has(channel)) throw new Error(`No handler registered for '${channel}'`)
      },
    },
    contextBridge: {
      exposeInMainWorld: (_name: string, api: typeof electron.api) => { electron.api = api },
    },
  }
})

import { app } from 'electron'

describe('main process startup and preload contract', () => {
  beforeAll(async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    await import('./main.js')
    await import('./preload.js')
  })

  afterAll(() => { vi.unstubAllEnvs() })

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
})
