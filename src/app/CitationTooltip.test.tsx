// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CitationTooltip } from './CitationTooltip'

describe('CitationTooltip [P2-03]', () => {
  it('renders the reference text as a tooltip positioned at the given coordinates', () => {
    render(<CitationTooltip text="Smith, J. Title A." left={10} top={20} />)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Smith, J. Title A.')
    expect(tooltip.style.left).toBe('10px')
    expect(tooltip.style.top).toBe('20px')
  })
})
