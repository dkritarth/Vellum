// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { RightPanel } from './RightPanel'

afterEach(() => {
  cleanup()
})

describe('RightPanel', () => {
  it('defaults to the Ask tab', () => {
    render(<RightPanel />)
    expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/start asking questions/i)).toBeInTheDocument()
  })

  it('switches to Details on click and shows its empty state', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Details' }))

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(/metadata will show here/i)).toBeInTheDocument()
  })

  it('renders a visible "coming soon" stub for deferred tabs (Notes, Annotations)', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.getByText(/Notes — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-01/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Annotations' }))
    expect(screen.getByText(/Annotations — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-02/)).toBeInTheDocument()
  })

  it('only ever shows one tab panel at a time', async () => {
    const user = userEvent.setup()
    render(<RightPanel />)

    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })
})
