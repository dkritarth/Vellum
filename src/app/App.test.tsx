// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// App mounts Reader ([P1-09]), which imports pdfjs-dist. pdfjs-dist's canvas
// module touches browser APIs (DOMMatrix) jsdom doesn't implement — mock it
// the same way Reader.test.tsx does; this test only cares about shell layout.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    render(): Promise<void> {
      return Promise.resolve()
    }
  },
  getDocument: () => ({ promise: new Promise(() => {}) }),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'worker-url' }))

beforeEach(() => {
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      ping: vi.fn().mockResolvedValue('pong'),
      readPaperFile: vi.fn().mockResolvedValue(null),
    },
  })
})

afterEach(() => {
  cleanup()
})

describe('App shell', () => {
  it('renders with zero papers without crashing', () => {
    render(<App />)

    // Top tab strip empty state.
    expect(screen.getByText(/No papers open/i)).toBeInTheDocument()
    // Sidebar nav.
    expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument()
    // Center pane empty state.
    expect(screen.getByText(/No paper open/i)).toBeInTheDocument()
    // Right panel default tab.
    expect(screen.getByRole('tab', { name: 'Ask' })).toBeInTheDocument()
    // Reader toolbar highlight stub, visible even with no paper open.
    expect(screen.getByRole('button', { name: /highlight/i })).toBeInTheDocument()
    // Workspace switcher.
    expect(screen.getByRole('button', { name: /switch workspace/i })).toBeInTheDocument()
  })
})
