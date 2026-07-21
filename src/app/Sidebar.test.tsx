// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'

afterEach(() => {
  cleanup()
})

describe('Sidebar', () => {
  it('defaults to the Files view showing the folder-tree stub linking [P2-05]', () => {
    render(<Sidebar />)

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Folders — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-05/)).toBeInTheDocument()
  })

  it('switches to Chats and shows its "coming soon" stub linking [P2-06]', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('tab', { name: 'Chats' }))

    expect(screen.getByText(/Chats — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-06/)).toBeInTheDocument()
  })

  it('shows the Trash stub linking [P2-08]', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Trash' }))

    expect(screen.getByText(/Trash — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-08/)).toBeInTheDocument()
  })

  it('shows the Usage stub linking [P2-09]', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Usage' }))

    expect(screen.getByText(/Usage — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-09/)).toBeInTheDocument()
  })

  it('renders the workspace switcher trigger', () => {
    render(<Sidebar />)
    expect(screen.getByRole('button', { name: /switch workspace/i })).toBeInTheDocument()
  })

  it('keeps primary nav working alongside the new sidebar chrome', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  })
})
