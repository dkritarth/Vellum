import type { Database } from 'better-sqlite3'
import type { AcpBackend } from '../acp/client.js'

export interface UsageRecord {
  id?: number
  sessionId?: number | null
  backend: AcpBackend
  model?: string | null
  turnIndex: number
  inputTokens?: number | null
  outputTokens?: number | null
  thoughtTokens?: number | null
  cachedReadTokens?: number | null
  cachedWriteTokens?: number | null
  totalTokens?: number | null
  contextUsed?: number | null
  contextSize?: number | null
  costAmount?: number | null
  costCurrency?: string | null
  hasMetrics: boolean
  recordedAt: string
}

export interface BackendUsageSummary {
  backend: AcpBackend
  turnsCount: number
  turnsWithMetrics: number
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalTokens: number | null
  contextUsedLatest: number | null
  contextSizeLatest: number | null
  totalCost: number | null
  costCurrency: string | null
  lastRecordedAt: string | null
}

export interface UsageSummary {
  totalTurns: number
  turnsWithMetrics: number
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalTokens: number | null
  totalCost: number | null
  backends: Record<AcpBackend, BackendUsageSummary>
}

interface UsageRow {
  id: number
  session_id: number | null
  backend: string
  model: string | null
  turn_index: number
  input_tokens: number | null
  output_tokens: number | null
  thought_tokens: number | null
  cached_read_tokens: number | null
  cached_write_tokens: number | null
  total_tokens: number | null
  context_used: number | null
  context_size: number | null
  cost_amount: number | null
  cost_currency: string | null
  has_metrics: number
  recorded_at: string
}

function rowToRecord(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    backend: row.backend as AcpBackend,
    model: row.model,
    turnIndex: row.turn_index,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    thoughtTokens: row.thought_tokens,
    cachedReadTokens: row.cached_read_tokens,
    cachedWriteTokens: row.cached_write_tokens,
    totalTokens: row.total_tokens,
    contextUsed: row.context_used,
    contextSize: row.context_size,
    costAmount: row.cost_amount,
    costCurrency: row.cost_currency,
    hasMetrics: row.has_metrics === 1,
    recordedAt: row.recorded_at,
  }
}

/**
 * Persist or update telemetry for a prompt turn.
 * Uses ON CONFLICT(session_id, turn_index) to prevent double-counting retries.
 * Privacy rule: strictly stores numeric telemetry and metadata; zero prompt content.
 */
export function recordTurnUsage(
  db: Database,
  record: Omit<UsageRecord, 'id'>,
): UsageRecord {
  const stmt = db.prepare(`
    INSERT INTO usage_records (
      session_id, backend, model, turn_index, input_tokens, output_tokens,
      thought_tokens, cached_read_tokens, cached_write_tokens, total_tokens,
      context_used, context_size, cost_amount, cost_currency, has_metrics, recorded_at
    ) VALUES (
      @sessionId, @backend, @model, @turnIndex, @inputTokens, @outputTokens,
      @thoughtTokens, @cachedReadTokens, @cachedWriteTokens, @totalTokens,
      @contextUsed, @contextSize, @costAmount, @costCurrency, @hasMetrics, @recordedAt
    )
    ON CONFLICT(session_id, turn_index) DO UPDATE SET
      backend = excluded.backend,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      thought_tokens = excluded.thought_tokens,
      cached_read_tokens = excluded.cached_read_tokens,
      cached_write_tokens = excluded.cached_write_tokens,
      total_tokens = excluded.total_tokens,
      context_used = excluded.context_used,
      context_size = excluded.context_size,
      cost_amount = excluded.cost_amount,
      cost_currency = excluded.cost_currency,
      has_metrics = excluded.has_metrics,
      recorded_at = excluded.recorded_at
  `)

  stmt.run({
    sessionId: record.sessionId ?? null,
    backend: record.backend,
    model: record.model ?? null,
    turnIndex: record.turnIndex,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    thoughtTokens: record.thoughtTokens ?? null,
    cachedReadTokens: record.cachedReadTokens ?? null,
    cachedWriteTokens: record.cachedWriteTokens ?? null,
    totalTokens: record.totalTokens ?? null,
    contextUsed: record.contextUsed ?? null,
    contextSize: record.contextSize ?? null,
    costAmount: record.costAmount ?? null,
    costCurrency: record.costCurrency ?? 'USD',
    hasMetrics: record.hasMetrics ? 1 : 0,
    recordedAt: record.recordedAt,
  })

  const row = db
    .prepare(
      'SELECT * FROM usage_records WHERE session_id IS ? AND turn_index = ?',
    )
    .get(record.sessionId ?? null, record.turnIndex) as UsageRow | undefined

  if (!row) {
    throw new Error('Failed to retrieve recorded usage row')
  }

  return rowToRecord(row)
}

export interface ListUsageOptions {
  backend?: AcpBackend
  sessionId?: number
  limit?: number
}

export function listUsageRecords(
  db: Database,
  options: ListUsageOptions = {},
): UsageRecord[] {
  let query = 'SELECT * FROM usage_records'
  const conditions: string[] = []
  const params: unknown[] = []

  if (options.backend) {
    conditions.push('backend = ?')
    params.push(options.backend)
  }
  if (options.sessionId !== undefined) {
    conditions.push('session_id = ?')
    params.push(options.sessionId)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  query += ' ORDER BY recorded_at DESC, id DESC'

  if (options.limit && options.limit > 0) {
    query += ' LIMIT ?'
    params.push(options.limit)
  }

  const rows = db.prepare(query).all(...params) as UsageRow[]
  return rows.map(rowToRecord)
}

/**
 * Returns aggregated usage metrics by backend and overall totals.
 * CRITICAL RULE: If no metrics were provided by the adapter (`turnsWithMetrics === 0`),
 * token counts and costs return `null` ("Unavailable"), NEVER 0.
 */
export function getUsageSummary(db: Database): UsageSummary {
  const backends: AcpBackend[] = ['claude', 'codex']
  const backendSummaries: Record<AcpBackend, BackendUsageSummary> = {
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
  }

  let grandTotalTurns = 0
  let grandTurnsWithMetrics = 0
  let grandInputTokens: number | null = null
  let grandOutputTokens: number | null = null
  let grandTokens: number | null = null
  let grandCost: number | null = null

  for (const backend of backends) {
    const agg = db
      .prepare(`
        SELECT
          COUNT(*) as turns_count,
          SUM(has_metrics) as turns_with_metrics,
          SUM(input_tokens) as sum_input,
          SUM(output_tokens) as sum_output,
          SUM(total_tokens) as sum_total,
          SUM(cost_amount) as sum_cost,
          MAX(cost_currency) as cost_currency,
          MAX(recorded_at) as last_recorded_at
        FROM usage_records
        WHERE backend = ?
      `)
      .get(backend) as {
        turns_count: number
        turns_with_metrics: number | null
        sum_input: number | null
        sum_output: number | null
        sum_total: number | null
        sum_cost: number | null
        cost_currency: string | null
        last_recorded_at: string | null
      }

    const latestContext = db
      .prepare(`
        SELECT context_used, context_size
        FROM usage_records
        WHERE backend = ? AND context_used IS NOT NULL
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1
      `)
      .get(backend) as { context_used: number; context_size: number } | undefined

    const turnsCount = agg?.turns_count ?? 0
    const turnsWithMetrics = agg?.turns_with_metrics ?? 0

    const summary: BackendUsageSummary = {
      backend,
      turnsCount,
      turnsWithMetrics,
      totalInputTokens: turnsWithMetrics > 0 ? (agg.sum_input ?? null) : null,
      totalOutputTokens: turnsWithMetrics > 0 ? (agg.sum_output ?? null) : null,
      totalTokens: turnsWithMetrics > 0 ? (agg.sum_total ?? null) : null,
      contextUsedLatest: latestContext?.context_used ?? null,
      contextSizeLatest: latestContext?.context_size ?? null,
      totalCost: turnsWithMetrics > 0 && agg.sum_cost !== null ? agg.sum_cost : null,
      costCurrency: agg?.cost_currency ?? null,
      lastRecordedAt: agg?.last_recorded_at ?? null,
    }

    backendSummaries[backend] = summary

    grandTotalTurns += turnsCount
    grandTurnsWithMetrics += turnsWithMetrics

    if (summary.totalInputTokens !== null) {
      grandInputTokens = (grandInputTokens ?? 0) + summary.totalInputTokens
    }
    if (summary.totalOutputTokens !== null) {
      grandOutputTokens = (grandOutputTokens ?? 0) + summary.totalOutputTokens
    }
    if (summary.totalTokens !== null) {
      grandTokens = (grandTokens ?? 0) + summary.totalTokens
    }
    if (summary.totalCost !== null) {
      grandCost = (grandCost ?? 0) + summary.totalCost
    }
  }

  return {
    totalTurns: grandTotalTurns,
    turnsWithMetrics: grandTurnsWithMetrics,
    totalInputTokens: grandTurnsWithMetrics > 0 ? grandInputTokens : null,
    totalOutputTokens: grandTurnsWithMetrics > 0 ? grandOutputTokens : null,
    totalTokens: grandTurnsWithMetrics > 0 ? grandTokens : null,
    totalCost: grandTurnsWithMetrics > 0 && grandCost !== null ? grandCost : null,
    backends: backendSummaries,
  }
}
