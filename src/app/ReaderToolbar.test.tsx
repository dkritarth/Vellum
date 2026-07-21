// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ReaderToolbar } from './ReaderToolbar'

afterEach(() => {
  cleanup()
})

describe('ReaderToolbar', () => {
  it('renders the Highlight button', () => {
    render(<ReaderToolbar />)
    expect(screen.getByRole('button', { name: /highlight/i })).toBeInTheDocument()
  })

  it('shows a "coming soon" stub linking [P2-02] on click', async () => {
    const user = userEvent.setup()
    render(<ReaderToolbar />)

    await user.click(screen.getByRole('button', { name: /highlight/i }))

    expect(screen.getByText(/Highlight — coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/P2-02/)).toBeInTheDocument()
  })
})
