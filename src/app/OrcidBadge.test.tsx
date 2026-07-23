// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { OrcidBadge } from './OrcidBadge'

it('renders a link to the ORCID profile with accessible label and new-tab attrs', () => {
  render(<OrcidBadge name="Jane Doe" orcid="0000-0002-1825-0097" />)
  const link = screen.getByRole('link', { name: 'ORCID profile for Jane Doe' })
  expect(link).toHaveAttribute('href', 'https://orcid.org/0000-0002-1825-0097')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})
