// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModelSelector } from './ModelSelector'

describe('ModelSelector', () => {
  it('lists sanctioned ACP backends and reports a selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelSelector backend="claude" onChange={onChange} />)

    expect(screen.getByRole('option', { name: 'Claude' })).toHaveValue('claude')
    expect(screen.getByRole('option', { name: 'Codex' })).toHaveValue('codex')
    await user.selectOptions(screen.getByLabelText(/model backend/i), 'codex')

    expect(onChange).toHaveBeenCalledWith('codex')
  })
})
