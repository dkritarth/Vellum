import { describe, expect, it } from 'vitest'
import { friendlyIpcError } from './ipcError'

describe('friendlyIpcError', () => {
  it('strips the Electron IPC wrapper, nested Error and function-name prefixes', () => {
    expect(
      friendlyIpcError(
        new Error("Error invoking remote method 'vellum:ingest': Error: classifyInput: local PDF not found: /x.pdf"),
      ),
    ).toBe('Local PDF not found: /x.pdf')
  })

  it('keeps human-readable prefixes such as "arXiv API:"', () => {
    expect(friendlyIpcError(new Error("Error invoking remote method 'vellum:ingest': Error: arXiv API: missing title for 1"))).toBe(
      'arXiv API: missing title for 1',
    )
  })

  it('passes plain messages through and falls back for empty or unknown errors', () => {
    expect(friendlyIpcError(new Error('Failed to fetch from arXiv'))).toBe('Failed to fetch from arXiv')
    expect(friendlyIpcError('offline')).toBe('offline')
    expect(friendlyIpcError(undefined, 'Could not ingest')).toBe('Could not ingest')
  })
})
