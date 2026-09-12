// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

afterEach(() => {
  cleanup()
})

describe('Sidebar', () => {
  it('defaults to the Files view showing the active Collections tree [L2-01]', () => {
    render(<Sidebar />)

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tree', { name: 'Collections' })).toBeInTheDocument()
    expect(screen.getByText('All Papers')).toBeInTheDocument()
  })

  it('switches to Chats and renders the active ChatsList [L2-02]', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('tab', { name: 'Chats' }))

    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument()
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

  it('calls onSelectUsage when Usage footer item is clicked [L2-05]', async () => {
    const user = userEvent.setup()
    const onSelectUsage = vi.fn()
    render(<Sidebar onSelectUsage={onSelectUsage} />)

    await user.click(screen.getByRole('button', { name: 'Usage' }))

    expect(onSelectUsage).toHaveBeenCalledTimes(1)
  })

  it('keeps primary nav working alongside the new sidebar chrome', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  })
  it('invokes onSelectTrash when Trash is clicked and handler is provided [L2-04]', async () => {
    const user = userEvent.setup()
    const onSelectTrash = vi.fn()
    render(<Sidebar onSelectTrash={onSelectTrash} />)

    await user.click(screen.getByRole('button', { name: 'Trash' }))

    expect(onSelectTrash).toHaveBeenCalledTimes(1)
  })
})
