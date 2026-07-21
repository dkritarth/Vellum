// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

afterEach(() => {
  cleanup()
})

describe('WorkspaceSwitcher', () => {
  it('renders the current workspace trigger', () => {
    render(<WorkspaceSwitcher />)
    expect(screen.getByRole('button', { name: /switch workspace/i })).toBeInTheDocument()
  })

  it('shows a "coming soon" stub linking [P2-10] on click', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSwitcher />)

    await user.click(screen.getByRole('button', { name: /switch workspace/i }))

    expect(screen.getByText(/Workspaces — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-10/)).toBeInTheDocument()
  })
})
