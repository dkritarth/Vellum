// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DetailsPanel } from './DetailsPanel'

beforeEach(() => Object.defineProperty(window, 'vellum', { configurable: true, value: { getPaper: vi.fn().mockResolvedValue({ title: 'Paper', authors: ['Author'], year: 2026, summary: 'Short summary.', sections: [{ title: 'Introduction' }], addedAt: 't' }) } }))

it('shows stored summary and metadata', async () => {
  render(<DetailsPanel slug="p1" />)
  expect(await screen.findByText('Short summary.')).toBeInTheDocument()
  expect(screen.getByText('Author')).toBeInTheDocument()
  expect(screen.getByText('Introduction')).toBeInTheDocument()
})
