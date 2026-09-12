// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectionMenu } from './SelectionMenu'

describe('SelectionMenu', () => {
  it('renders actions and triggers onAddToChat and onExplain', () => {
    const onAddToChat = vi.fn()
    const onExplain = vi.fn()
    const onHighlight = vi.fn()
    const onClose = vi.fn()

    render(
      <SelectionMenu
        x={100}
        y={200}
        quote="Transformer self-attention"
        page={3}
        onAddToChat={onAddToChat}
        onExplain={onExplain}
        onHighlight={onHighlight}
        onClose={onClose}
      />,
    )

    const addToChatBtn = screen.getByRole('button', { name: 'Add to chat' })
    const explainBtn = screen.getByRole('button', { name: 'Explain' })

    fireEvent.click(addToChatBtn)
    expect(onAddToChat).toHaveBeenCalledTimes(1)

    fireEvent.click(explainBtn)
    expect(onExplain).toHaveBeenCalledTimes(1)

    const yellowSwatch = screen.getByRole('button', { name: 'Highlight yellow' })
    fireEvent.click(yellowSwatch)
    expect(onHighlight).toHaveBeenCalledWith('yellow')
  })

  it('dismisses on Escape key', () => {
    const onClose = vi.fn()
    render(
      <SelectionMenu
        x={100}
        y={200}
        quote="Test quote"
        page={1}
        onAddToChat={vi.fn()}
        onExplain={vi.fn()}
        onHighlight={vi.fn()}
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
