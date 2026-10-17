// End-to-end orchestrator tests. Hermetic by construction:
//  - input is a `local_pdf` (fixtures/sample.pdf) so fetch.ts's local_pdf
//    branch reads it straight off disk — no network call, no fetch stub needed.
//  - the ACP extract step is driven through a fake AcpClient (same pattern as
//    extract.test.ts) — no real adapter spawned.
//  - the DB is an in-memory core/store/db.ts instance.
//  - files are written under a per-test temp dir, never the repo's real data/.

import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import Database from 'better-sqlite3'
import { MIGRATIONS, runMigrations } from '../store/migrate.js'

import type { AcpClient, AcpPromptRequest, AcpSession, AcpUpdate } from '../acp/client.js'
import { getPaper, listPapers, upsertPaper } from '../library/repo.js'
import { getNote, upsertNote } from '../notes/repo.js'
import { addChatMessage, createChatSession, getChatMessages, getLatestChatSession } from '../chat/repo.js'
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

      expect(result.slug).toMatch(/^local-sample-[a-f0-9]{64}$/)
      expect(result.title).toBe('Sample Paper Title (agent-refined)')
      expect(result.metadata).toEqual({
        title: 'Sample Paper Title (agent-refined)',
        authors: ['Agent Author'],
        year: 2026,
        venue: 'Agent Venue',
        abstract: 'Agent-written abstract.',
      })
      expect(result.paths.pdfPath).toBe(join(tmpDir, 'papers', result.slug, 'paper.pdf'))
      expect(result.paths.mdPath).toBe(join(tmpDir, 'papers', result.slug, 'paper.md'))

      expect(existsSync(result.paths.pdfPath)).toBe(true)
      expect(existsSync(result.paths.mdPath)).toBe(true)
      const md = readFileSync(result.paths.mdPath, 'utf-8')
      expect(md).toMatch(/^# Sample Paper Title\s*$/m)

      const row = getPaper(db, result.slug)
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

  it('keeps distinct same-basename files, metadata and research separate across restart and repeat ingest', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-collision-'))
    const firstSource = join(tmpDir, 'alpha', 'paper.pdf')
    const secondSource = join(tmpDir, 'beta', 'paper.pdf')
    mkdirSync(join(tmpDir, 'alpha'))
    mkdirSync(join(tmpDir, 'beta'))
    copyFileSync(FIXTURE_PDF, firstSource)
    // A legal trailing PDF comment makes bytes distinct, without mocking conversion.
    writeFileSync(secondSource, Buffer.concat([readFileSync(FIXTURE_PDF), Buffer.from('\n% Second source\n')]))
    const dbPath = join(tmpDir, 'app.db')
    let db = openDb({ path: dbPath })
    const clientFor = (title: string) => new FakeClient([textUpdate(JSON.stringify({
      sections: [], metadata: { title, authors: [title + ' author'] },
    })), doneUpdate])
    try {
      const first = await ingest(firstSource, { db, dataDir: tmpDir, client: clientFor('Alpha paper') })
      upsertNote(db, first.slug, 'Alpha research')
      const chat = createChatSession(db, { paperSlug: first.slug, backend: 'codex' })
      addChatMessage(db, { sessionId: chat.id, role: 'user', content: 'Alpha question' })
      const firstPdf = readFileSync(first.paths.pdfPath)
      const firstMarkdown = readFileSync(first.paths.mdPath)
      const second = await ingest(secondSource, { db, dataDir: tmpDir, client: clientFor('Beta paper') })
      expect(second.slug).not.toBe(first.slug)
      expect(readFileSync(first.paths.pdfPath)).toEqual(firstPdf)
      expect(readFileSync(first.paths.mdPath)).toEqual(firstMarkdown)
      expect(readFileSync(second.paths.pdfPath)).toEqual(readFileSync(secondSource))
      expect(getPaper(db, first.slug)?.title).toBe('Alpha paper')
      expect(getPaper(db, second.slug)?.authors).toEqual(['Beta paper author'])
      expect(getNote(db, second.slug)).toBeUndefined()
      expect(getLatestChatSession(db, second.slug)).toBeUndefined()
      db.close()
      db = openDb({ path: dbPath })
      const repeated = await ingest(secondSource, { db, dataDir: tmpDir, client: clientFor('Beta paper') })
      expect(repeated.slug).toBe(second.slug)
      expect(listPapers(db)).toHaveLength(2)
      expect(getNote(db, first.slug)?.body).toBe('Alpha research')
      expect(getChatMessages(db, chat.id).map(message => message.content)).toEqual(['Alpha question'])
      expect(getPaper(db, first.slug)?.title).toBe('Alpha paper')
    } finally {
      db.close()
    }
  })

  it('reuses a byte-matched legacy slug, preserves research, and remembers its source after bytes change', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-legacy-'))
    const source = join(tmpDir, 'paper.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const paperDir = join(tmpDir, 'papers', 'local-paper')
    mkdirSync(paperDir, { recursive: true })
    const pdfPath = join(paperDir, 'paper.pdf')
    const mdPath = join(paperDir, 'paper.md')
    copyFileSync(source, pdfPath)
    writeFileSync(mdPath, '# Legacy paper')
    const dbPath = join(tmpDir, 'app.db')
    // Build a pre-fix database, then reopen through the normal upgrade path.
    const oldDb = new Database(dbPath)
    runMigrations(oldDb, MIGRATIONS.filter(migration => migration.version <= 8))
    upsertPaper(oldDb, { slug: 'local-paper', title: 'Legacy title', authors: [], pdfPath, mdPath, addedAt: '2025-01-01T00:00:00Z' })
    upsertNote(oldDb, 'local-paper', 'Legacy research')
    oldDb.close()
    let db = openDb({ path: dbPath })
    const client = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
    try {
      const chat = createChatSession(db, { paperSlug: 'local-paper', backend: 'codex' })
      addChatMessage(db, { sessionId: chat.id, role: 'user', content: 'Legacy question' })
      const foreignSource = join(tmpDir, 'foreign', 'paper.pdf')
      mkdirSync(join(tmpDir, 'foreign'))
      writeFileSync(foreignSource, Buffer.concat([readFileSync(source), Buffer.from('\n% Different source\n')]))
      const foreign = await ingest(foreignSource, { db, dataDir: tmpDir, client })
      expect(foreign.slug).not.toBe('local-paper')
      expect(getPaper(db, 'local-paper')?.title).toBe('Legacy title')
      expect(readFileSync(pdfPath)).toEqual(readFileSync(source))
      expect(readFileSync(mdPath, 'utf8')).toBe('# Legacy paper')
      const adopted = await ingest(source, { db, dataDir: tmpDir, client })
      expect(adopted.slug).toBe('local-paper')
      expect(adopted.paths).toEqual({ pdfPath, mdPath })
      const identicalSource = join(tmpDir, 'identical', 'paper.pdf')
      mkdirSync(join(tmpDir, 'identical'))
      copyFileSync(source, identicalSource)
      const identical = await ingest(identicalSource, { db, dataDir: tmpDir, client })
      expect(identical.slug).not.toBe(adopted.slug)
      expect(identical.slug).not.toBe(foreign.slug)
      db.close()
      db = openDb({ path: dbPath })
      writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('\n% Source updated\n')]))
      const repeated = await ingest(source, { db, dataDir: tmpDir, client })
      expect(repeated.slug).toBe('local-paper')
      expect(listPapers(db)).toHaveLength(3)
      expect(getNote(db, 'local-paper')?.body).toBe('Legacy research')
      expect(getChatMessages(db, chat.id).map(message => message.content)).toEqual(['Legacy question'])
      expect(readFileSync(pdfPath)).toEqual(readFileSync(source))
    } finally {
      db.close()
    }
  })

  it('keeps same-basename URL sources separate, including query variants with identical PDF bytes', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-urls-'))
    const bytes = new Uint8Array(readFileSync(FIXTURE_PDF))
    // Public IP literals avoid DNS dependency; only the external HTTP transport
    // is stubbed. Classification, safe fetching, conversion and storage are real.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { status: 200 })))
    const sources = [
      'https://93.184.216.34/paper.pdf?paper=alpha',
      'https://93.184.216.34/paper.pdf?paper=beta',
      'https://93.184.216.35/paper.pdf',
      'https://93.184.216.34/other/paper.pdf',
    ]
    const dbPath = join(tmpDir, 'app.db')
    let db = openDb({ path: dbPath })
    const client = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
    try {
      const slugs: string[] = []
      for (const source of sources) {
        const paper = await ingest(source, { db, dataDir: tmpDir, client })
        slugs.push(paper.slug)
        upsertNote(db, paper.slug, source)
      }
      expect(new Set(slugs).size).toBe(4)
      db.close()
      db = openDb({ path: dbPath })
      const repeated = await ingest(sources[0] + '#page=2', { db, dataDir: tmpDir, client })
      expect(repeated.slug).toBe(slugs[0])
      expect(listPapers(db)).toHaveLength(4)
      for (let i = 0; i < slugs.length; i++) {
        expect(getNote(db, slugs[i])?.body).toBe(sources[i])
        expect(readFileSync(getPaper(db, slugs[i])!.pdfPath!)).toEqual(Buffer.from(bytes))
      }
    } finally {
      db.close()
      vi.unstubAllGlobals()
    }
  })

  // Shared Crossref fixture for the authorOrcids alignment tests below.
  const CROSSREF_ORCID_BODY = JSON.stringify({
    message: {
      title: ['Crossref Title'],
      author: [
        { given: 'Ada', family: 'Lovelace', ORCID: 'http://orcid.org/0000-0002-1825-0097' },
        { given: 'Alan', family: 'Turing' },
      ],
      published: { 'date-parts': [[2022, 1, 1]] },
    },
  })

  function stubCrossrefFetch(pdfBytes: Buffer) {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('api.crossref.org/works/')) {
        return Promise.resolve(
          new Response(CROSSREF_ORCID_BODY, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      if (url.startsWith('https://doi.org/')) {
        return Promise.resolve(new Response(new Uint8Array(pdfBytes), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it('drops authorOrcids when agent-extracted authors diverge from the Crossref list they were aligned to', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })
    // AGENT_JSON's authors (['Agent Author']) differ from the Crossref
    // fixture's authors (['Ada Lovelace', 'Alan Turing']) — agent authors win
    // per the extracted-first merge, so the Crossref-aligned ORCIDs would
    // misalign if kept.
    const client = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
    stubCrossrefFetch(readFileSync(FIXTURE_PDF))

    try {
      const result = await ingest('10.1234/orcid-divergent-test', { db, dataDir: tmpDir, client })

      expect(result.metadata.authors).toEqual(['Agent Author'])
      expect(result.metadata.authorOrcids).toBeUndefined()

      const row = getPaper(db, result.slug)
      expect(row?.authorOrcids).toBeUndefined()
    } finally {
      db.close()
      vi.unstubAllGlobals()
    }
  })

  it('retains authorOrcids when agent-extracted authors are content-equal to the Crossref list', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })
    const agentJsonMatchingCrossref = JSON.stringify({
      sections: [{ title: 'Sample Paper Title', startOffset: 0, endOffset: 20 }],
      metadata: {
        title: 'Sample Paper Title (agent-refined)',
        authors: ['Ada Lovelace', 'Alan Turing'],
        year: 2026,
      },
    })
    const client = new FakeClient([textUpdate(agentJsonMatchingCrossref), doneUpdate])
    stubCrossrefFetch(readFileSync(FIXTURE_PDF))

    try {
      const result = await ingest('10.1234/orcid-aligned-test', { db, dataDir: tmpDir, client })

      expect(result.metadata.authors).toEqual(['Ada Lovelace', 'Alan Turing'])
      expect(result.metadata.authorOrcids).toEqual(['0000-0002-1825-0097', null])

      const row = getPaper(db, result.slug)
      expect(row?.authorOrcids).toEqual(['0000-0002-1825-0097', null])
    } finally {
      db.close()
      vi.unstubAllGlobals()
    }
  })

  it('retains authorOrcids when the agent extracts no authors (falls back to the Crossref-aligned list)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })
    // Agent returns nothing usable -> extractPaper degrades to {}, so
    // metadata.authors falls back to fetched.metadata.authors verbatim.
    const client = new FakeClient([textUpdate('no json here'), doneUpdate])
    stubCrossrefFetch(readFileSync(FIXTURE_PDF))

    try {
      const result = await ingest('10.1234/orcid-fallback-test', { db, dataDir: tmpDir, client })

      expect(result.metadata.authors).toEqual(['Ada Lovelace', 'Alan Turing'])
      expect(result.metadata.authorOrcids).toEqual(['0000-0002-1825-0097', null])

      const row = getPaper(db, result.slug)
      expect(row?.authorOrcids).toEqual(['0000-0002-1825-0097', null])
    } finally {
      db.close()
      vi.unstubAllGlobals()
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
      expect(rows.map((r) => r.slug)).toEqual([first.slug])

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
