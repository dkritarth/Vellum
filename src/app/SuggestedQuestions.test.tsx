// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuggestedQuestions } from './SuggestedQuestions'
import type { SuggestedQuestionRecord } from '../../core/questions/repo'

describe('SuggestedQuestions [L2-03]', () => {
  const mockQuestions: SuggestedQuestionRecord[] = [
    {
      id: 1,
      paperSlug: 'attention-is-all-you-need',
      backend: 'claude',
      question: 'How does multi-head attention compare to standard RNNs?',
      category: 'methodology',
      createdAt: '2026-03-01T10:00:00.000Z',
    },
    {
      id: 2,
      paperSlug: 'attention-is-all-you-need',
      backend: 'claude',
      question: 'What are the main performance gains on English-to-German translation?',
      category: 'results',
      createdAt: '2026-03-01T10:00:00.000Z',
    },
  ]

  beforeEach(() => {
    window.vellum = {
      ...window.vellum,
      questionsGet: vi.fn().mockResolvedValue(mockQuestions),
      questionsRegenerate: vi.fn().mockResolvedValue(mockQuestions),
    } as any
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders suggested questions with category pills', async () => {
    render(
      <SuggestedQuestions
        slug="attention-is-all-you-need"
        backend="claude"
        disabled={false}
        onSelectQuestion={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('How does multi-head attention compare to standard RNNs?'),
    ).toBeInTheDocument()
    expect(screen.getByText('Method')).toBeInTheDocument()
    expect(screen.getByText('Results')).toBeInTheDocument()
    expect(window.vellum.questionsGet).toHaveBeenCalledWith('attention-is-all-you-need', 'claude')
  })

  it('invokes onSelectQuestion when clicking a question chip', async () => {
    const onSelect = vi.fn()
    render(
      <SuggestedQuestions
        slug="attention-is-all-you-need"
        backend="claude"
        disabled={false}
        onSelectQuestion={onSelect}
      />,
    )

    const chip = await screen.findByText('How does multi-head attention compare to standard RNNs?')
    fireEvent.click(chip)

    expect(onSelect).toHaveBeenCalledWith(
      'How does multi-head attention compare to standard RNNs?',
    )
  })

  it('regenerates questions when Refresh button is clicked', async () => {
    render(
      <SuggestedQuestions
        slug="attention-is-all-you-need"
        backend="claude"
        disabled={false}
        onSelectQuestion={vi.fn()}
      />,
    )

    await screen.findByText('How does multi-head attention compare to standard RNNs?')
    const refreshBtn = screen.getByRole('button', { name: 'Regenerate suggested questions' })
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(window.vellum.questionsRegenerate).toHaveBeenCalledWith(
        'attention-is-all-you-need',
        'claude',
      )
    })
  })

  it('renders retry button when loading fails', async () => {
    vi.mocked(window.vellum.questionsGet).mockRejectedValueOnce(new Error('Network offline'))

    render(
      <SuggestedQuestions
        slug="attention-is-all-you-need"
        backend="claude"
        disabled={false}
        onSelectQuestion={vi.fn()}
      />,
    )

    expect(await screen.findByText(/Failed to load suggestions/)).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Retry' })
    expect(retryBtn).toBeInTheDocument()

    // Clicking retry calls questionsGet again
    fireEvent.click(retryBtn)
    await waitFor(() => {
      expect(window.vellum.questionsGet).toHaveBeenCalledTimes(2)
    })
  })
})
