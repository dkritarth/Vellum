// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'

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
