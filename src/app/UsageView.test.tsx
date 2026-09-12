// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageView } from './UsageView.js'
import type { UsageSummary, UsageRecord } from '../../core/usage/repo.js'

describe('UsageView [L2-05]', () => {
  let usageGetSummary: ReturnType<typeof vi.fn>
  let usageGetList: ReturnType<typeof vi.fn>

  const emptySummary: UsageSummary = {
    totalTurns: 0,
    turnsWithMetrics: 0,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalTokens: null,
    totalCost: null,
    backends: {
      claude: {
        backend: 'claude',
        turnsCount: 0,
        turnsWithMetrics: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        contextUsedLatest: null,
        contextSizeLatest: null,
        totalCost: null,
        costCurrency: null,
        lastRecordedAt: null,
      },
      codex: {
        backend: 'codex',
        turnsCount: 0,
        turnsWithMetrics: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        contextUsedLatest: null,
        contextSizeLatest: null,
        totalCost: null,
        costCurrency: null,
        lastRecordedAt: null,
      },
    },
  }

  const unavailableSummary: UsageSummary = {
    totalTurns: 2,
    turnsWithMetrics: 0,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalTokens: null,
    totalCost: null,
    backends: {
      claude: {
        backend: 'claude',
        turnsCount: 0,
        turnsWithMetrics: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        contextUsedLatest: null,
        contextSizeLatest: null,
        totalCost: null,
        costCurrency: null,
        lastRecordedAt: null,
      },
      codex: {
        backend: 'codex',
        turnsCount: 2,
        turnsWithMetrics: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        contextUsedLatest: null,
        contextSizeLatest: null,
        totalCost: null,
        costCurrency: null,
        lastRecordedAt: '2026-09-12T16:00:00.000Z',
      },
    },
  }

  const populatedSummary: UsageSummary = {
    totalTurns: 3,
    turnsWithMetrics: 2,
    totalInputTokens: 2500,
    totalOutputTokens: 500,
    totalTokens: 3000,
    totalCost: 0.035,
    backends: {
      claude: {
        backend: 'claude',
        turnsCount: 2,
        turnsWithMetrics: 2,
        totalInputTokens: 2500,
        totalOutputTokens: 500,
        totalTokens: 3000,
        contextUsedLatest: 15400,
        contextSizeLatest: 200000,
        totalCost: 0.035,
        costCurrency: 'USD',
        lastRecordedAt: '2026-09-12T16:20:00.000Z',
      },
      codex: {
        backend: 'codex',
        turnsCount: 1,
        turnsWithMetrics: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        contextUsedLatest: null,
        contextSizeLatest: null,
        totalCost: null,
        costCurrency: null,
        lastRecordedAt: '2026-09-12T16:25:00.000Z',
      },
    },
  }

  const mockRecords: UsageRecord[] = [
    {
      id: 1,
      sessionId: 10,
      backend: 'claude',
      turnIndex: 0,
      inputTokens: 1200,
      outputTokens: 250,
      totalTokens: 1450,
      hasMetrics: true,
      recordedAt: '2026-09-12T16:10:00.000Z',
    },
    {
      id: 2,
      sessionId: 11,
      backend: 'codex',
      turnIndex: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      hasMetrics: false,
      recordedAt: '2026-09-12T16:15:00.000Z',
    },
  ]

  beforeEach(() => {
    usageGetSummary = vi.fn().mockResolvedValue(emptySummary)
    usageGetList = vi.fn().mockResolvedValue([])

    Object.defineProperty(window, 'vellum', {
      configurable: true,
      value: { usageGetSummary, usageGetList },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders loading state initially', () => {
    render(<UsageView />)
    expect(screen.getByText(/loading usage telemetry/i)).toBeInTheDocument()
  })

  it('honestly displays "Unavailable" rather than 0 when adapter emits no metrics', async () => {
    usageGetSummary.mockResolvedValueOnce(unavailableSummary)
    usageGetList.mockResolvedValueOnce([mockRecords[1]])

    render(<UsageView />)

    await waitFor(() => {
      expect(screen.getByText('ACP Usage & Plan Telemetry')).toBeInTheDocument()
    })

    const codexCard = screen.getByTestId('codex-usage-card')
    expect(codexCard).toBeInTheDocument()
    expect(codexCard).toHaveTextContent('2') // Turns recorded

    // Crucial check: must display "Unavailable", NOT "0 tokens" or "0" for input/output/total tokens
    const unavailableBadges = codexCard.querySelectorAll('span')
    const hasUnavailable = Array.from(unavailableBadges).some((el) => el.textContent === 'Unavailable')
    expect(hasUnavailable).toBe(true)

    expect(codexCard).not.toHaveTextContent('0 tokens')
  })

  it('renders authentic metric counts when telemetry is present', async () => {
    usageGetSummary.mockResolvedValueOnce(populatedSummary)
    usageGetList.mockResolvedValueOnce(mockRecords)

    render(<UsageView />)

    await waitFor(() => {
      expect(screen.getByText('ACP Usage & Plan Telemetry')).toBeInTheDocument()
    })

    const claudeCard = screen.getByTestId('claude-usage-card')
    expect(claudeCard).toHaveTextContent('2,500 tokens')
    expect(claudeCard).toHaveTextContent('500 tokens')
    expect(claudeCard).toHaveTextContent('3,000 tokens')
    expect(claudeCard).toHaveTextContent('15,400 / 200,000')
    expect(claudeCard).toHaveTextContent('$0.0350 USD')
  })

  it('renders recent turn activity table with emitted and unavailable rows', async () => {
    usageGetSummary.mockResolvedValueOnce(populatedSummary)
    usageGetList.mockResolvedValueOnce(mockRecords)

    render(<UsageView />)

    await waitFor(() => {
      expect(screen.getByText('Recent Turn Activity')).toBeInTheDocument()
    })

    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText('Emitted')).toBeInTheDocument()
    expect(screen.getAllByText('#1')).toHaveLength(2)
  })

  it('triggers onBackToLibrary callback when clicking back button', async () => {
    const onBack = vi.fn()
    usageGetSummary.mockResolvedValueOnce(populatedSummary)

    render(<UsageView onBackToLibrary={onBack} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /back to library/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('refreshes telemetry when clicking Refresh button', async () => {
    usageGetSummary.mockResolvedValue(populatedSummary)
    usageGetList.mockResolvedValue(mockRecords)

    render(<UsageView />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh usage data/i })).toBeInTheDocument()
    })

    expect(usageGetSummary).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /refresh usage data/i }))
    expect(usageGetSummary).toHaveBeenCalledTimes(2)
  })

  it('displays error banner when loading fails', async () => {
    usageGetSummary.mockRejectedValueOnce(new Error('IPC query failed'))

    render(<UsageView />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('IPC query failed')
    })
  })
})
