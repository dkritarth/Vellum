// End-to-end orchestrator tests. Hermetic by construction:
//  - input is a `local_pdf` (fixtures/sample.pdf) so fetch.ts's local_pdf
//    branch reads it straight off disk — no network call, no fetch stub needed.
//  - the ACP extract step is driven through a fake AcpClient (same pattern as
//    extract.test.ts) — no real adapter spawned.
//  - the DB is an in-memory core/store/db.ts instance.
//  - files are written under a per-test temp dir, never the repo's real data/.

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import type { AcpClient, AcpPromptRequest, AcpSession, AcpUpdate } from '../acp/client.js'
import { getPaper, listPapers } from '../library/repo.js'
import { openDb } from '../store/db.js'
import { ingest } from './index.js'

const FIXTURE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url))

class FakeSession implements AcpSession {
  disposed = false
  requests: AcpPromptRequest[] = []
  constructor(private readonly updates: AcpUpdate[]) {}
  async *prompt(req: AcpPromptRequest): AsyncIterable<AcpUpdate> {
    this.requests.push(req)
    for (const update of this.updates) yield update
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

class FakeClient implements AcpClient {
  session: FakeSession | undefined
  constructor(private readonly updates: AcpUpdate[] = []) {}
  async newSession(): Promise<AcpSession> {
    this.session = new FakeSession(this.updates)
    return this.session
  }
}

function textUpdate(text: string): AcpUpdate {
  return { kind: 'text', data: { type: 'text', text } }
}
const doneUpdate: AcpUpdate = { kind: 'done', data: { stopReason: 'end_turn' } }

const AGENT_JSON = JSON.stringify({
  sections: [
    { title: 'Sample Paper Title', startOffset: 0, endOffset: 20 },
    { title: '1. Introduction', startOffset: 21, endOffset: 100 },
  ],
  metadata: {
    title: 'Sample Paper Title (agent-refined)',
    authors: ['Agent Author'],
    year: 2026,
    venue: 'Agent Venue',
    abstract: 'Agent-written abstract.',
  },
})

describe('ingest', () => {
  let tmpDir: string | undefined

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = undefined
    }
  })

  it('writes paper.pdf + paper.md, inserts the DB row, and returns an IngestResult', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])

    try {
      const result = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client })

      expect(result.slug).toBe('local-sample')
      expect(result.title).toBe('Sample Paper Title (agent-refined)')
      expect(result.metadata).toEqual({
        title: 'Sample Paper Title (agent-refined)',
        authors: ['Agent Author'],
        year: 2026,
        venue: 'Agent Venue',
        abstract: 'Agent-written abstract.',
      })
      expect(result.paths.pdfPath).toBe(join(tmpDir, 'papers', 'local-sample', 'paper.pdf'))
      expect(result.paths.mdPath).toBe(join(tmpDir, 'papers', 'local-sample', 'paper.md'))

      expect(existsSync(result.paths.pdfPath)).toBe(true)
      expect(existsSync(result.paths.mdPath)).toBe(true)
      const md = readFileSync(result.paths.mdPath, 'utf-8')
      expect(md).toMatch(/^# Sample Paper Title\s*$/m)

      const row = getPaper(db, 'local-sample')
      expect(row?.title).toBe('Sample Paper Title (agent-refined)')
      expect(row?.sections).toEqual([
        { title: 'Sample Paper Title', startOffset: 0, endOffset: 20 },
        { title: '1. Introduction', startOffset: 21, endOffset: 100 },
      ])

      // extractPaper was passed the actual mdPath just written, as a
      // contextFile (agent reads the file itself — no inlined content).
      expect(client.session?.requests[0]?.contextFiles).toEqual([result.paths.mdPath])
    } finally {
      db.close()
    }
  })

  it('falls back to fetch-time metadata for fields a degraded agent extraction omits', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })
    // Agent returns nothing usable -> extractPaper degrades to {}.
    const client = new FakeClient([textUpdate('no json here'), doneUpdate])

    try {
      const result = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client })

      // local_pdf has no fetch-time metadata either (fetch.ts: undefined for
      // local_pdf/pdf_url) — falls all the way back to the classified value
      // (the input path) so title is never empty.
      expect(result.title).toBe(FIXTURE_PDF)
      expect(result.metadata.authors).toEqual([])
    } finally {
      db.close()
    }
  })

  it('re-ingesting the same input is idempotent: no duplicate row, files overwritten not duplicated', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })

    try {
      const client1 = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
      const first = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client: client1 })

      const client2 = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
      const second = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client: client2 })

      expect(second.slug).toBe(first.slug)
      expect(second.paths).toEqual(first.paths)

      const rows = listPapers(db)
      expect(rows.filter((r) => r.slug === 'local-sample')).toHaveLength(1)

      // File still valid/parseable after a second write (not corrupted/appended).
      const md = readFileSync(second.paths.mdPath, 'utf-8')
      expect(md).toMatch(/^# Sample Paper Title\s*$/m)
      const pdfBytesLen = readFileSync(second.paths.pdfPath).byteLength
      expect(pdfBytesLen).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })
})
