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
})

describe('TabStrip closing (#202)', () => {
  it('closes a tab via its × button and via middle-click', async () => {
    const user = userEvent.setup()
    const onCloseTab = vi.fn()
    const onSelectTab = vi.fn()
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
    expect(onSelectTab).not.toHaveBeenCalled()

    await user.pointer({ keys: '[MouseMiddle]', target: screen.getByRole('tab', { name: 'Paper A' }) })
    expect(onCloseTab).toHaveBeenCalledWith('a')
  })

  it('shows no close buttons without onCloseTab', () => {
    render(<TabStrip tabs={[{ id: 'a', title: 'Paper A' }]} activeTabId="a" />)
    expect(screen.queryByRole('button', { name: 'Close Paper A' })).toBeNull()
  })
})
