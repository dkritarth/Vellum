// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabStrip } from './TabStrip'

afterEach(() => {
  cleanup()
})

describe('TabStrip', () => {
  it('shows the empty state with zero tabs', () => {
    render(<TabStrip />)
    expect(screen.getByText(/No papers open/i)).toBeInTheDocument()
  })

  it('renders one tab per paper, marking the active one selected', () => {
    render(
      <TabStrip
        tabs={[
          { id: 'a', title: 'Paper A' },
          { id: 'b', title: 'Paper B' },
        ]}
        activeTabId="b"
      />,
    )

    expect(screen.getByRole('tab', { name: 'Paper A' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Paper B' })).toHaveAttribute('aria-selected', 'true')
  })

  it('clicking a tab calls onSelectTab with its id', async () => {
    const user = userEvent.setup()
    const onSelectTab = vi.fn()
    render(<TabStrip tabs={[{ id: 'a', title: 'Paper A' }]} activeTabId={null} onSelectTab={onSelectTab} />)

    await user.click(screen.getByRole('tab', { name: 'Paper A' }))

    expect(onSelectTab).toHaveBeenCalledWith('a')
  })

  it('closes a tab from its close button or a middle-click without selecting it', async () => {
    const user = userEvent.setup()
    const onSelectTab = vi.fn()
    const onCloseTab = vi.fn()
    render(
      <TabStrip
        tabs={[
          { id: 'a', title: 'Paper A' },
          { id: 'b', title: 'Paper B' },
        ]}
        activeTabId="a"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close Paper B' }))
    expect(onCloseTab).toHaveBeenCalledWith('b')

    await user.pointer({ keys: '[MouseMiddle]', target: screen.getByRole('tab', { name: 'Paper A' }) })
    expect(onCloseTab).toHaveBeenCalledWith('a')
    expect(onSelectTab).not.toHaveBeenCalled()
  })

  it('shows the full title as a tooltip and an enabled + button that calls onNewTab', async () => {
    const user = userEvent.setup()
    const onNewTab = vi.fn()
    render(<TabStrip tabs={[{ id: 'a', title: 'A long paper title' }]} activeTabId="a" onNewTab={onNewTab} />)

    expect(screen.getByRole('tab', { name: 'A long paper title' })).toHaveAttribute('title', 'A long paper title')
    const plus = screen.getByRole('button', { name: /open another paper/i })
    expect(plus).toBeEnabled()
    await user.click(plus)
    expect(onNewTab).toHaveBeenCalledTimes(1)
  })
})
