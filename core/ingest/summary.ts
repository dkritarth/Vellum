import type { AcpBackend, AcpClient } from '../acp/client.js'
import { StdioAcpClient } from '../acp/stdio-client.js'

export async function summarizePaper(mdPath: string, options: { client?: AcpClient; backend?: AcpBackend } = {}): Promise<string | undefined> {
  const client = options.client ?? new StdioAcpClient()
  const session = await client.newSession(options.backend ?? 'claude').catch(() => undefined)
  if (!session) return undefined
  try {
    let text = ''
    let completed = false
    for await (const update of session.prompt({
      text: `Read ${mdPath} with your file tools. Write a concise 2–4 sentence summary grounded only in this paper.`,
      contextFiles: [mdPath],
    })) {
      if (update.kind === 'text' && typeof update.data === 'object' && update.data !== null) {
        const block = update.data as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string') text += block.text
      }
      if (update.kind === 'error') return undefined
      if (update.kind === 'done') {
        // Legacy clients emit done without a reason. Honor that contract,
        // but only end_turn is successful when a reason is exposed.
        const stopReason = typeof update.data === 'object' && update.data !== null
          ? (update.data as Record<string, unknown>).stopReason
          : undefined
        completed = stopReason === undefined || stopReason === 'end_turn'
        break
      }
    }
    return completed ? text.trim() || undefined : undefined
  } catch {
    return undefined
  } finally {
    await session.dispose().catch(() => undefined)
  }
}
