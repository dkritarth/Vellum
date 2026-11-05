// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickActions } from './QuickActions'

afterEach(() => {
  cleanup()
})

const EXPECTED = [
  ['Breakdown', /break down this paper section by section/i],
  ['Practice questions', /practice questions based only on this paper/i],
  ['Study guide', /focused study guide for this paper/i],
] as const

describe('QuickActions', () => {
  it('exposes the actions as a named group so screen readers announce it', () => {
    render(<QuickActions disabled={false} onPrompt={vi.fn()} />)

    const group = screen.getByRole('group', { name: 'Quick actions' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(
      EXPECTED.map(([label]) => label),
    )
  })

  it.each(EXPECTED)('clicking %s sends exactly its own prompt once', async (label, prompt) => {
    const user = userEvent.setup()
    const onPrompt = vi.fn()
    render(<QuickActions disabled={false} onPrompt={onPrompt} />)

    await user.click(screen.getByRole('button', { name: label }))

    expect(onPrompt).toHaveBeenCalledTimes(1)
    expect(onPrompt.mock.calls[0][0]).toMatch(prompt)
  })

  it('sends a distinct prompt per action', async () => {
    const user = userEvent.setup()
    const onPrompt = vi.fn()
    render(<QuickActions disabled={false} onPrompt={onPrompt} />)

    for (const [label] of EXPECTED) {
      await user.click(screen.getByRole('button', { name: label }))
    }

    const prompts = onPrompt.mock.calls.map(([p]) => p)
    expect(new Set(prompts).size).toBe(EXPECTED.length)
  })

  it('does not submit an enclosing form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <QuickActions disabled={false} onPrompt={vi.fn()} />
      </form>,
    )

    await user.click(screen.getByRole('button', { name: 'Breakdown' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('is operable from the keyboard with Tab, Enter, and Space', async () => {
    const user = userEvent.setup()
    const onPrompt = vi.fn()
    render(<QuickActions disabled={false} onPrompt={onPrompt} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Breakdown' })).toHaveFocus()
    await user.keyboard('{Enter}')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Practice questions' })).toHaveFocus()
    await user.keyboard(' ')

    expect(onPrompt).toHaveBeenCalledTimes(2)
    expect(onPrompt.mock.calls[0][0]).toMatch(EXPECTED[0][1])
    expect(onPrompt.mock.calls[1][0]).toMatch(EXPECTED[1][1])
  })

  it('when disabled, every action is disabled, skipped by Tab, and never fires', async () => {
    const user = userEvent.setup()
    const onPrompt = vi.fn()
    render(
      <>
        <QuickActions disabled onPrompt={onPrompt} />
        <button type="button">after</button>
      </>,
    )

    for (const button of screen.getByRole('group', { name: 'Quick actions' }).querySelectorAll('button')) {
      expect(button).toBeDisabled()
      await user.click(button)
    }
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onPrompt).not.toHaveBeenCalled()
  })

  it('re-enables when the disabled prop clears', async () => {
    const user = userEvent.setup()
    const onPrompt = vi.fn()
    const { rerender } = render(<QuickActions disabled onPrompt={onPrompt} />)

    rerender(<QuickActions disabled={false} onPrompt={onPrompt} />)
    await user.click(screen.getByRole('button', { name: 'Study guide' }))

    expect(onPrompt).toHaveBeenCalledTimes(1)
  })
})
