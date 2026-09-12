// [L2-05] UsageView: surfaces authentic ACP token/session telemetry
// and explicit "Unavailable" state when adapters do not emit metrics.
import { useState, useEffect, useCallback } from 'react'
import type { UsageSummary, UsageRecord } from '../../core/usage/repo.js'
import styles from './UsageView.module.css'

export interface UsageViewProps {
  onBackToLibrary?: () => void
}

export function UsageView({ onBackToLibrary }: UsageViewProps): JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadUsage = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      setError(null)
      const [sum, list] = await Promise.all([
        window.vellum.usageGetSummary(),
        window.vellum.usageGetList({ limit: 50 }),
      ])
      setSummary(sum)
      setRecords(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage telemetry')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  const formatNumber = (val: number | null | undefined, unit: string = ''): string => {
    if (val === null || val === undefined) return 'Unavailable'
    return `${val.toLocaleString()}${unit ? ` ${unit}` : ''}`
  }

  const formatCost = (cost: number | null | undefined, currency: string | null = 'USD'): string => {
    if (cost === null || cost === undefined) return 'Unavailable'
    return `$${cost.toFixed(4)} ${currency ?? 'USD'}`
  }

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch {
      return iso
    }
  }

  return (
    <div className={styles.container} role="region" aria-label="Usage and telemetry view">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>ACP Usage &amp; Plan Telemetry</h1>
          {summary && (
            <span className={styles.count}>
              {summary.totalTurns} {summary.totalTurns === 1 ? 'turn' : 'turns'} recorded
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void loadUsage()}
            disabled={loading}
            aria-label="Refresh usage data"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          {onBackToLibrary && (
            <button
              type="button"
              className={styles.backButton}
              onClick={onBackToLibrary}
              aria-label="Back to Library"
            >
              ← Back to Library
            </button>
          )}
        </div>
      </div>

      <div className={styles.noticeBanner} role="note">
        <strong>First-Party Telemetry Only:</strong> Vellum connects directly to official ACP adapters
        (<code>claude-code-acp</code> via Agent-SDK credit, <code>codex-acp</code> via ChatGPT subscription).
        Metrics are displayed exactly as emitted by adapter streams. When an adapter omits token counts, Vellum
        reports <em>Unavailable</em> rather than fabricating zero values.
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {loading && !summary ? (
        <div className={styles.loading}>Loading usage telemetry...</div>
      ) : summary ? (
        <>
          <div className={styles.grid}>
            {/* Claude Adapter Card */}
            <div className={styles.card} data-testid="claude-usage-card">
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>Claude (claude-code-acp)</div>
                <span className={summary.backends.claude.turnsCount > 0 ? styles.badgeActive : styles.badgeIdle}>
                  {summary.backends.claude.turnsCount > 0 ? 'Active' : 'Idle'}
                </span>
              </div>
              <div className={styles.metricsList}>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Turns Recorded</span>
                  <span className={styles.metricValue}>{summary.backends.claude.turnsCount}</span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Input Tokens</span>
                  <span className={summary.backends.claude.totalInputTokens !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatNumber(summary.backends.claude.totalInputTokens, 'tokens')}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Output Tokens</span>
                  <span className={summary.backends.claude.totalOutputTokens !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatNumber(summary.backends.claude.totalOutputTokens, 'tokens')}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Total Tokens</span>
                  <span className={summary.backends.claude.totalTokens !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatNumber(summary.backends.claude.totalTokens, 'tokens')}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Context Window</span>
                  <span className={summary.backends.claude.contextUsedLatest !== null ? styles.metricValue : styles.metricUnavailable}>
                    {summary.backends.claude.contextUsedLatest !== null && summary.backends.claude.contextSizeLatest !== null
                      ? `${summary.backends.claude.contextUsedLatest.toLocaleString()} / ${summary.backends.claude.contextSizeLatest.toLocaleString()}`
                      : 'Unavailable'}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Plan Cost / Credit</span>
                  <span className={summary.backends.claude.totalCost !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatCost(summary.backends.claude.totalCost, summary.backends.claude.costCurrency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Codex Adapter Card */}
            <div className={styles.card} data-testid="codex-usage-card">
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>Codex (codex-acp)</div>
                <span className={summary.backends.codex.turnsCount > 0 ? styles.badgeActive : styles.badgeIdle}>
                  {summary.backends.codex.turnsCount > 0 ? 'Active' : 'Idle'}
                </span>
              </div>
              <div className={styles.metricsList}>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Turns Recorded</span>
                  <span className={styles.metricValue}>{summary.backends.codex.turnsCount}</span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Input Tokens</span>
                  <span className={summary.backends.codex.totalInputTokens !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatNumber(summary.backends.codex.totalInputTokens, 'tokens')}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Output Tokens</span>
                  <span className={summary.backends.codex.totalOutputTokens !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatNumber(summary.backends.codex.totalOutputTokens, 'tokens')}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Total Tokens</span>
                  <span className={summary.backends.codex.totalTokens !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatNumber(summary.backends.codex.totalTokens, 'tokens')}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Context Window</span>
                  <span className={summary.backends.codex.contextUsedLatest !== null ? styles.metricValue : styles.metricUnavailable}>
                    {summary.backends.codex.contextUsedLatest !== null && summary.backends.codex.contextSizeLatest !== null
                      ? `${summary.backends.codex.contextUsedLatest.toLocaleString()} / ${summary.backends.codex.contextSizeLatest.toLocaleString()}`
                      : 'Unavailable'}
                  </span>
                </div>
                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>Plan Cost / Credit</span>
                  <span className={summary.backends.codex.totalCost !== null ? styles.metricValue : styles.metricUnavailable}>
                    {formatCost(summary.backends.codex.totalCost, summary.backends.codex.costCurrency)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className={styles.activitySection}>
            <h2 className={styles.sectionTitle}>Recent Turn Activity</h2>
            {records.length === 0 ? (
              <div className={styles.emptyState}>
                No ACP turns recorded yet. Open a paper and Ask a question to start recording adapter activity.
              </div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Backend</th>
                      <th>Turn</th>
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                      <th>Total</th>
                      <th>Telemetry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, idx) => (
                      <tr key={r.id ?? idx}>
                        <td>{formatDate(r.recordedAt)}</td>
                        <td>
                          <span className={styles.backendBadge}>{r.backend}</span>
                        </td>
                        <td>#{r.turnIndex + 1}</td>
                        <td>
                          {r.inputTokens !== null && r.inputTokens !== undefined ? (
                            r.inputTokens.toLocaleString()
                          ) : (
                            <span className={styles.tableUnavailable}>Unavailable</span>
                          )}
                        </td>
                        <td>
                          {r.outputTokens !== null && r.outputTokens !== undefined ? (
                            r.outputTokens.toLocaleString()
                          ) : (
                            <span className={styles.tableUnavailable}>Unavailable</span>
                          )}
                        </td>
                        <td>
                          {r.totalTokens !== null && r.totalTokens !== undefined ? (
                            r.totalTokens.toLocaleString()
                          ) : (
                            <span className={styles.tableUnavailable}>Unavailable</span>
                          )}
                        </td>
                        <td>
                          {r.hasMetrics ? (
                            <span className={styles.badgeReported}>Emitted</span>
                          ) : (
                            <span className={styles.badgeNotReported}>Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
