// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReaderToolbar } from './ReaderToolbar'

afterEach(() => {
  cleanup()
})

describe('ReaderToolbar', () => {
  it('renders the Highlight button, inactive by default', () => {
    render(<ReaderToolbar active={false} color="yellow" onToggle={vi.fn()} onColorChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /highlight/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onToggle when the Highlight button is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<ReaderToolbar active={false} color="yellow" onToggle={onToggle} onColorChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /highlight/i }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows a color swatch per highlight color only while active', () => {
    const { rerender } = render(<ReaderToolbar active={false} color="yellow" onToggle={vi.fn()} onColorChange={vi.fn()} />)
    expect(screen.queryByLabelText(/highlight color/i)).not.toBeInTheDocument()

    rerender(<ReaderToolbar active color="yellow" onToggle={vi.fn()} onColorChange={vi.fn()} />)
    expect(screen.getByLabelText('yellow highlight color')).toBeInTheDocument()
    expect(screen.getByLabelText('green highlight color')).toBeInTheDocument()
    expect(screen.getByLabelText('blue highlight color')).toBeInTheDocument()
    expect(screen.getByLabelText('pink highlight color')).toBeInTheDocument()
  })

  it('marks the currently selected color swatch and calls onColorChange on click', async () => {
    const user = userEvent.setup()
    const onColorChange = vi.fn()
    render(<ReaderToolbar active color="yellow" onToggle={vi.fn()} onColorChange={onColorChange} />)

    expect(screen.getByLabelText('yellow highlight color')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('green highlight color')).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByLabelText('green highlight color'))

    expect(onColorChange).toHaveBeenCalledWith('green')
  })
})
