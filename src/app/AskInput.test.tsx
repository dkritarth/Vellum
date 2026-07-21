// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AskInput } from './AskInput'

afterEach(() => {
  cleanup()
})

describe('AskInput', () => {
  it('renders a disabled input bar with skills and context triggers', () => {
    render(<AskInput />)

    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Context' })).toBeInTheDocument()
  })

  it('shows a "coming soon" stub for the `/` skill picker', async () => {
    const user = userEvent.setup()
    render(<AskInput />)

    await user.click(screen.getByRole('button', { name: 'Skills' }))

    expect(screen.getByText(/Skills — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-11/)).toBeInTheDocument()
  })

  it('shows a "coming soon" stub for `@` context mentions', async () => {
    const user = userEvent.setup()
    render(<AskInput />)

    await user.click(screen.getByRole('button', { name: 'Context' }))

    expect(screen.getByText(/Context — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-11/)).toBeInTheDocument()
  })
})
