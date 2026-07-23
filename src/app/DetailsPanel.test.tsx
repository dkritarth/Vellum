// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DetailsPanel } from './DetailsPanel'

beforeEach(() => Object.defineProperty(window, 'vellum', { configurable: true, value: { getPaper: vi.fn().mockResolvedValue({ title: 'Paper', authors: ['Author'], year: 2026, summary: 'Short summary.', sections: [{ title: 'Introduction' }], addedAt: 't' }) } }))

afterEach(() => {
  cleanup()
})

it('shows stored summary and metadata', async () => {
  render(<DetailsPanel slug="p1" />)
  expect(await screen.findByText('Short summary.')).toBeInTheDocument()
  expect(screen.getByText('Author')).toBeInTheDocument()
  expect(screen.getByText('Introduction')).toBeInTheDocument()
})

it('renders an ORCID badge for authors with an ORCID and plain text for those without', async () => {
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      getPaper: vi.fn().mockResolvedValue({
        title: 'Paper',
        authors: ['Jane Doe', 'John Smith'],
        authorOrcids: ['0000-0002-1825-0097', null],
        year: 2026,
        addedAt: 't',
      }),
    },
  })
  render(<DetailsPanel slug="p1" />)
  const link = await screen.findByRole('link', { name: 'ORCID profile for Jane Doe' })
  expect(link).toHaveAttribute('href', 'https://orcid.org/0000-0002-1825-0097')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByText('John Smith')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'ORCID profile for John Smith' })).not.toBeInTheDocument()
})

it('renders all authors as plain text when authorOrcids is absent (graceful absence)', async () => {
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      getPaper: vi.fn().mockResolvedValue({
        title: 'Paper',
        authors: ['Jane Doe', 'John Smith'],
        year: 2026,
        addedAt: 't',
      }),
    },
  })
  render(<DetailsPanel slug="p1" />)
  await screen.findByText('Jane Doe')
  expect(screen.getByText('John Smith')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

it('handles authorOrcids shorter than authors (defensive index access)', async () => {
  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: {
      getPaper: vi.fn().mockResolvedValue({
        title: 'Paper',
        authors: ['Jane Doe', 'John Smith'],
        authorOrcids: ['0000-0002-1825-0097'],
        year: 2026,
        addedAt: 't',
      }),
    },
  })
  render(<DetailsPanel slug="p1" />)
  expect(await screen.findByRole('link', { name: 'ORCID profile for Jane Doe' })).toBeInTheDocument()
  expect(screen.getByText('John Smith')).toBeInTheDocument()
})
