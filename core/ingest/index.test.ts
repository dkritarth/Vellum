// End-to-end orchestrator tests. Hermetic by construction:
//  - input is a `local_pdf` (fixtures/sample.pdf) so fetch.ts's local_pdf
//    branch reads it straight off disk — no network call, no fetch stub needed.
//  - the ACP extract step is driven through a fake AcpClient (same pattern as
//    extract.test.ts) — no real adapter spawned.
//  - the DB is an in-memory core/store/db.ts instance.
//  - files are written under a per-test temp dir, never the repo's real data/.

import fs, { readdirSync, mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import Database from 'better-sqlite3'
import { MIGRATIONS, runMigrations } from '../store/migrate.js'

import type { AcpClient, AcpPromptRequest, AcpSession, AcpUpdate } from '../acp/client.js'
import { getPaper, listPapers, restorePaper, trashPaper, upsertPaper } from '../library/repo.js'
import { createHighlight, listHighlights } from '../highlights/repo.js'
import { addChatMessage, createChatSession, getChatMessages, getChatSession, getLatestChatSession } from '../chat/repo.js'
import { assignPaperToCollection, createCollection, listPaperCollections } from '../collections/repo.js'
import { openDb } from '../store/db.js'
import { getNote, upsertNote } from '../notes/repo.js'
import { ingest } from './index.js'

const FIXTURE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url))

class FakeSession implements AcpSession {
  disposed = false
  requests: AcpPromptRequest[] = []
  contextContents: string[] = []
  constructor(private readonly updates: AcpUpdate[]) {}
  async *prompt(req: AcpPromptRequest): AsyncIterable<AcpUpdate> {
    this.requests.push(req)
    this.contextContents.push(...(req.contextFiles ?? []).map(file => readFileSync(file, 'utf8')))
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
    vi.restoreAllMocks()
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

      // Analysis reads the candidate from disk before it is published.
      expect(client.session?.contextContents).toEqual([md])
      const contextPath = client.session?.requests[0]?.contextFiles?.[0]
      expect(contextPath).not.toBe(result.paths.mdPath)
      expect(existsSync(contextPath!)).toBe(false)
    } finally {
      db.close()
    }
  })

  it('preserves published content and all research after a rejected DB update, reopen, and retry', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-preserve-'))
    const source = join(tmpDir, 'source.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const dbPath = join(tmpDir, 'app.db')
    let db = openDb({ path: dbPath })
    const client = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
    try {
      const original = await ingest(source, { db, dataDir: tmpDir, client })
      upsertNote(db, original.slug, 'Research about original content')
      createHighlight(db, { id: 'original', paperSlug: original.slug, page: 1, color: 'yellow', quote: 'Sample Paper Title', anchor: '{}', createdAt: '2026-01-01' })
      const collection = createCollection(db, { name: 'Research' })
      assignPaperToCollection(db, { paperSlug: original.slug, collectionId: collection.id })
      const chat = createChatSession(db, { paperSlug: original.slug, backend: 'codex' })
      addChatMessage(db, { sessionId: chat.id, role: 'user', content: 'Original question' })
      const research = () => ({
        note: getNote(db, original.slug), highlights: listHighlights(db, original.slug),
        collections: listPaperCollections(db, original.slug), chat: getChatMessages(db, chat.id),
      })
      const oldResearch = research()
      const oldRow = getPaper(db, original.slug)
      const oldPdf = readFileSync(original.paths.pdfPath)
      const oldMd = readFileSync(original.paths.mdPath)
      db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON papers BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END")
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      await expect(ingest(source, { db, dataDir: tmpDir, client })).rejects.toThrow('injected storage failure')
      db.close()
      db = openDb({ path: dbPath })
      expect(getPaper(db, original.slug)).toEqual(oldRow)
      expect(research()).toEqual(oldResearch)
      expect(readFileSync(original.paths.pdfPath)).toEqual(oldPdf)
      expect(readFileSync(original.paths.mdPath)).toEqual(oldMd)
      db.exec('DROP TRIGGER reject_update')
      const retry = await ingest(source, { db, dataDir: tmpDir, client: new FakeClient() })
      expect(retry.slug).toBe(original.slug)
      expect(retry.paths).toEqual(original.paths)
      expect(readFileSync(retry.paths.pdfPath)).toEqual(readFileSync(source))
      expect(readFileSync(retry.paths.mdPath)).not.toEqual(oldMd)
      expect(getPaper(db, retry.slug)?.title).toBe(source)
      expect(research()).toEqual(oldResearch)
      expect(listPapers(db)).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it.each(['candidate copy', 'original backup', 'second publication'])('restores original pair after %s failure', async (failure) => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-publication-'))
    const source = join(tmpDir, 'source.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    try {
      const original = await ingest(source, { db, dataDir: tmpDir, client })
      const oldPdf = readFileSync(original.paths.pdfPath)
      const oldMd = readFileSync(original.paths.mdPath)
      const oldRow = getPaper(db, original.slug)
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      const rename = fs.renameSync
      const copy = fs.copyFileSync
      vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, flags) => {
        if (failure === 'candidate copy' && String(from).endsWith('paper.md')) throw new Error('injected copy failure')
        return copy(from, to, flags)
      })
      let publicationFailed = false
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if ((failure === 'original backup' && from === original.paths.mdPath) ||
            (failure === 'second publication' && to === original.paths.mdPath && !publicationFailed)) {
          publicationFailed = true
          throw new Error('injected rename failure')
        }
        return rename(from, to)
      })
      await expect(ingest(source, { db, dataDir: tmpDir, client })).rejects.toThrow('injected')
      expect(readFileSync(original.paths.pdfPath)).toEqual(oldPdf)
      expect(readFileSync(original.paths.mdPath)).toEqual(oldMd)
      expect(getPaper(db, original.slug)).toEqual(oldRow)
      expect(readdirSync(join(tmpDir, 'papers'), { recursive: true }).filter(name => name.includes('.ingest-') || name.includes('.vellum-ingest-'))).toEqual([])
      vi.restoreAllMocks()
      await expect(ingest(source, { db, dataDir: tmpDir, client })).resolves.toMatchObject({ slug: original.slug })
    } finally { db.close() }
  })

  it('reports recovery locations and retains the only original if restoration fails', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-recovery-'))
    const source = join(tmpDir, 'source.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    try {
      const original = await ingest(source, { db, dataDir: tmpDir, client })
      const oldPdf = readFileSync(original.paths.pdfPath)
      const oldMd = readFileSync(original.paths.mdPath)
      const oldRow = getPaper(db, original.slug)
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      const rename = fs.renameSync
      let recoveryPath = ''
      let publicationFailed = false
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (to === original.paths.mdPath && !publicationFailed) {
          publicationFailed = true
          throw new Error('injected publication failure')
        }
        if (to === original.paths.pdfPath && publicationFailed) {
          recoveryPath = String(from)
          throw new Error('injected recovery failure')
        }
        return rename(from, to)
      })
      const error = await ingest(source, { db, dataDir: tmpDir, client }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as Error).message).toContain(recoveryPath)
      expect((error as Error).message).toContain(original.paths.pdfPath)
      expect((error as AggregateError).errors.map(String).join(' ')).toMatch(/publication failure.*recovery failure/)
      expect(readFileSync(recoveryPath)).toEqual(oldPdf)
      expect(readFileSync(original.paths.mdPath)).toEqual(oldMd)
      expect(getPaper(db, original.slug)).toEqual(oldRow)
      // Manual recovery remains possible from the reported original file.
      vi.restoreAllMocks()
      rename(recoveryPath, original.paths.pdfPath)
      expect(readFileSync(original.paths.pdfPath)).toEqual(oldPdf)
    } finally { db.close() }
  })

  it('rolls back new files, paper row and source binding together, then retries cleanly', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-new-failure-'))
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    try {
      db.exec("CREATE TRIGGER reject_binding BEFORE INSERT ON paper_sources BEGIN SELECT RAISE(ABORT, 'injected source binding failure'); END")
      await expect(ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client })).rejects.toThrow('injected source binding failure')
      expect(listPapers(db)).toEqual([])
      expect(db.prepare('SELECT * FROM paper_sources').all()).toEqual([])
      expect(readdirSync(join(tmpDir, 'papers'), { recursive: true }).filter(name => /paper\.(pdf|md)$|\.ingest-|\.vellum-ingest-/.test(String(name)))).toEqual([])
      db.exec('DROP TRIGGER reject_binding')
      const retry = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client })
      expect(readFileSync(retry.paths.pdfPath)).toEqual(readFileSync(FIXTURE_PDF))
      expect(db.prepare('SELECT paper_slug FROM paper_sources').all()).toEqual([{ paper_slug: retry.slug }])
    } finally { db.close() }
  })

  it('allows independent progress and prevents a failed overlapping re-ingest from undoing a successful one', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-overlap-'))
    const source = join(tmpDir, 'source.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const analyzing = new Promise<void>(resolve => { entered = resolve })
    let calls = 0
    const slow: AcpClient = { async newSession() {
      // Hold only first analysis; no database transaction may stay open here.
      if (++calls === 1) { entered(); await blocked }
      return new FakeSession([textUpdate(JSON.stringify({ sections: [], metadata: { title: 'Rejected candidate' } })), doneUpdate])
    } }
    try {
      const original = await ingest(source, { db, dataDir: tmpDir, client })
      const originalPdf = readFileSync(original.paths.pdfPath), originalMd = readFileSync(original.paths.mdPath)
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      const pending = ingest(source, { db, dataDir: tmpDir, client: slow })
      await analyzing
      expect(db.inTransaction).toBe(false)
      expect(readFileSync(original.paths.pdfPath)).toEqual(originalPdf)
      expect(readFileSync(original.paths.mdPath)).toEqual(originalMd)
      const independent = await ingest(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), { db, dataDir: tmpDir, client })
      expect(independent.slug).not.toBe(original.slug)
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      const success = await ingest(source, { db, dataDir: tmpDir, client })
      const successfulRow = getPaper(db, success.slug)
      const successfulPdf = readFileSync(success.paths.pdfPath)
      const successfulMd = readFileSync(success.paths.mdPath)
      db.exec("CREATE TRIGGER reject_candidate BEFORE UPDATE ON papers WHEN NEW.title = 'Rejected candidate' BEGIN SELECT RAISE(ABORT, 'injected concurrent failure'); END")
      release()
      await expect(pending).rejects.toThrow('injected concurrent failure')
      expect(getPaper(db, success.slug)).toEqual(successfulRow)
      expect(readFileSync(success.paths.pdfPath)).toEqual(successfulPdf)
      expect(readFileSync(success.paths.mdPath)).toEqual(successfulMd)
      expect(listPapers(db)).toHaveLength(2)
    } finally { release(); db.close() }
  })

  it('restores files when SQLite rejects COMMIT after successful statements', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-commit-'))
    const source = join(tmpDir, 'source.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    try {
      const original = await ingest(source, { db, dataDir: tmpDir, client })
      const oldPdf = readFileSync(original.paths.pdfPath), oldMd = readFileSync(original.paths.mdPath)
      const oldRow = getPaper(db, original.slug)
      db.exec(`CREATE TABLE deferred_failure (paper_slug TEXT REFERENCES papers(slug) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER reject_commit AFTER UPDATE ON papers BEGIN INSERT INTO deferred_failure VALUES ('missing-paper'); END;`)
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      await expect(ingest(source, { db, dataDir: tmpDir, client })).rejects.toThrow('FOREIGN KEY constraint failed')
      expect(db.inTransaction).toBe(false)
      expect(getPaper(db, original.slug)).toEqual(oldRow)
      expect(readFileSync(original.paths.pdfPath)).toEqual(oldPdf)
      expect(readFileSync(original.paths.mdPath)).toEqual(oldMd)
      expect(db.prepare('SELECT * FROM deferred_failure').all()).toEqual([])
    } finally { db.close() }
  })

  it('resolves concurrent legacy matches only at commit and rolls back failed adoption binding', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-legacy-overlap-'))
    const source = join(tmpDir, 'alpha', 'paper.pdf')
    const other = join(tmpDir, 'beta', 'paper.pdf')
    for (const directory of ['alpha', 'beta', 'legacy']) mkdirSync(join(tmpDir, directory))
    copyFileSync(FIXTURE_PDF, source)
    copyFileSync(FIXTURE_PDF, other)
    const pdfPath = join(tmpDir, 'legacy', 'paper.pdf'), mdPath = join(tmpDir, 'legacy', 'paper.md')
    copyFileSync(FIXTURE_PDF, pdfPath)
    writeFileSync(mdPath, '# Original legacy markdown')
    const db = openDb({ path: ':memory:' })
    let release!: () => void, entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const analyzing = new Promise<void>(resolve => { entered = resolve })
    const slow: AcpClient = { async newSession() { entered(); await blocked; return new FakeSession([]) } }
    try {
      upsertPaper(db, { slug: 'local-paper', title: 'Legacy', authors: [], pdfPath, mdPath, addedAt: '2025-01-01' })
      upsertNote(db, 'local-paper', 'Legacy research')
      db.exec("CREATE TRIGGER reject_adoption BEFORE UPDATE ON papers BEGIN SELECT RAISE(ABORT, 'injected adoption failure'); END")
      await expect(ingest(source, { db, dataDir: tmpDir, client: new FakeClient() })).rejects.toThrow('adoption failure')
      expect(db.prepare('SELECT * FROM paper_sources').all()).toEqual([])
      expect(readFileSync(mdPath, 'utf8')).toBe('# Original legacy markdown')
      db.exec('DROP TRIGGER reject_adoption')
      const pending = ingest(source, { db, dataDir: tmpDir, client: slow })
      await analyzing
      const winner = await ingest(other, { db, dataDir: tmpDir, client: new FakeClient() })
      expect(winner.slug).toBe('local-paper')
      const winnerRow = getPaper(db, winner.slug), winnerMd = readFileSync(mdPath)
      release()
      const later = await pending
      expect(later.slug).not.toBe(winner.slug)
      expect(getPaper(db, winner.slug)).toEqual(winnerRow)
      expect(readFileSync(mdPath)).toEqual(winnerMd)
      expect(getNote(db, winner.slug)?.body).toBe('Legacy research')
      expect(listPapers(db)).toHaveLength(2)
      expect(db.prepare('SELECT paper_slug FROM paper_sources ORDER BY paper_slug').all()).toEqual([
        { paper_slug: winner.slug }, { paper_slug: later.slug },
      ])
    } finally { release(); db.close() }
  })

  it('never replaces or deletes a directory found at a paper file path', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-nonfile-'))
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    try {
      const original = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client })
      rmSync(original.paths.mdPath)
      mkdirSync(original.paths.mdPath)
      const valuable = join(original.paths.mdPath, 'keep.txt')
      writeFileSync(valuable, 'Preserve unexpected existing data')
      await expect(ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client })).rejects.toThrow()
      expect(readFileSync(valuable, 'utf8')).toBe('Preserve unexpected existing data')
    } finally { db.close() }
  })

  it('reports success after commit even if temporary backup cleanup fails', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-cleanup-'))
    const source = join(tmpDir, 'source.pdf')
    copyFileSync(FIXTURE_PDF, source)
    const db = openDb({ path: ':memory:' })
    const client = new FakeClient()
    try {
      const original = await ingest(source, { db, dataDir: tmpDir, client })
      copyFileSync(fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url)), source)
      const remove = fs.rmSync
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
        if (String(target).includes('.vellum-ingest-')) throw new Error('injected cleanup failure')
        remove(target, options)
      })
      const updated = await ingest(source, { db, dataDir: tmpDir, client })
      expect(updated.slug).toBe(original.slug)
      expect(readFileSync(updated.paths.pdfPath)).toEqual(readFileSync(source))
      expect(readFileSync(updated.paths.mdPath, 'utf8')).toContain('Sample Paper Two')
      expect(getPaper(db, updated.slug)?.pdfPath).toBe(updated.paths.pdfPath)
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('temporary files retained at'), expect.any(Error))
    } finally { db.close() }
  })

  it('rejects a caller-owned transaction before doing any file work', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-transaction-'))
    const db = openDb({ path: ':memory:' })
    try {
      db.exec('BEGIN')
      await expect(ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client: new FakeClient() })).rejects.toThrow('requires ownership')
      expect(db.inTransaction).toBe(true)
      expect(existsSync(join(tmpDir, 'papers'))).toBe(false)
      db.exec('ROLLBACK')
    } finally { db.close() }
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

  it('keeps colliding DOI files and research separate through equivalent re-ingest and restart', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-doi-collision-'))
    const dbPath = join(tmpDir, 'app.db')
    let db = openDb({ path: dbPath })
    const alphaBytes = readFileSync(FIXTURE_PDF)
    const betaBytes = Buffer.concat([alphaBytes, Buffer.from('\n% Second DOI source\n')])
    const clientFor = (title: string) => new FakeClient([textUpdate(JSON.stringify({
      sections: [], metadata: { title, authors: [title + ' author'] },
    })), doneUpdate])
    try {
      stubCrossrefFetch(alphaBytes)
      const alpha = await ingest('10.1234/foo/bar', { db, dataDir: tmpDir, client: clientFor('Alpha DOI') })
      upsertNote(db, alpha.slug, 'Alpha DOI research')
      const alphaChat = createChatSession(db, { paperSlug: alpha.slug, backend: 'codex' })
      addChatMessage(db, { sessionId: alphaChat.id, role: 'user', content: 'Alpha DOI question' })
      const alphaMarkdown = readFileSync(alpha.paths.mdPath)
      stubCrossrefFetch(betaBytes)
      const beta = await ingest('10.1234/foo-bar', { db, dataDir: tmpDir, client: clientFor('Beta DOI') })
      expect(beta.slug).not.toBe(alpha.slug)
      upsertNote(db, beta.slug, 'Beta DOI research')
      const betaChat = createChatSession(db, { paperSlug: beta.slug, backend: 'codex' })
      addChatMessage(db, { sessionId: betaChat.id, role: 'user', content: 'Beta DOI question' })
      expect(readFileSync(alpha.paths.pdfPath)).toEqual(alphaBytes)
      expect(readFileSync(alpha.paths.mdPath)).toEqual(alphaMarkdown)
      expect(readFileSync(beta.paths.pdfPath)).toEqual(betaBytes)
      db.close()
      db = openDb({ path: dbPath })
      const repeated = await ingest('https://doi.org/10.1234/FOO-BAR', {
        db, dataDir: tmpDir, client: clientFor('Beta DOI refreshed'),
      })
      expect(repeated.slug).toBe(beta.slug)
      expect(repeated.paths).toEqual(beta.paths)
      expect(listPapers(db)).toHaveLength(2)
      expect(getPaper(db, alpha.slug)?.title).toBe('Alpha DOI')
      expect(getPaper(db, beta.slug)?.title).toBe('Beta DOI refreshed')
      expect(getPaper(db, beta.slug)?.doi).toBe('10.1234/foo-bar')
      expect(getNote(db, alpha.slug)?.body).toBe('Alpha DOI research')
      expect(getNote(db, beta.slug)?.body).toBe('Beta DOI research')
      expect(getChatMessages(db, alphaChat.id).map(message => message.content)).toEqual(['Alpha DOI question'])
      expect(getChatMessages(db, betaChat.id).map(message => message.content)).toEqual(['Beta DOI question'])
      expect(readFileSync(alpha.paths.pdfPath)).toEqual(alphaBytes)
      expect(readFileSync(alpha.paths.mdPath)).toEqual(alphaMarkdown)
    } finally {
      db.close()
      vi.unstubAllGlobals()
    }
  })

  it.each([
    { storedDoi: '10.1234/FOO/BAR', matches: true },
    { storedDoi: 'https://dx.doi.org/10.1234/FOO%2FBAR', matches: true },
    { storedDoi: '10.1234/foo-bar', matches: false },
    { storedDoi: undefined, matches: false },
  ])('reconciles legacy DOI $storedDoi by identity while preserving research across restart', async ({ storedDoi, matches }) => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-doi-legacy-'))
    const slug = 'doi-10.1234-foo-bar'
    const paperDir = join(tmpDir, 'papers', slug)
    mkdirSync(paperDir, { recursive: true })
    const pdfPath = join(paperDir, 'paper.pdf')
    const mdPath = join(paperDir, 'paper.md')
    const oldBytes = readFileSync(FIXTURE_PDF)
    writeFileSync(pdfPath, oldBytes)
    writeFileSync(mdPath, '# Legacy DOI paper')
    const dbPath = join(tmpDir, 'app.db')
    const oldDb = new Database(dbPath)
    runMigrations(oldDb, MIGRATIONS.filter(migration => migration.version <= 8))
    upsertPaper(oldDb, { slug, title: 'Legacy DOI', authors: [], doi: storedDoi,
      pdfPath, mdPath, addedAt: '2025-01-01T00:00:00Z' })
    upsertNote(oldDb, slug, 'Legacy DOI research')
    oldDb.close()
    let db = openDb({ path: dbPath })
    // Matching DOI may return updated bytes; conflicting DOI may serve identical
    // bytes. Neither content comparison nor the old slug establishes DOI identity.
    const incoming = matches ? Buffer.concat([oldBytes, Buffer.from('\n% Updated DOI PDF\n')]) : oldBytes
    stubCrossrefFetch(incoming)
    const client = new FakeClient([textUpdate(AGENT_JSON), doneUpdate])
    try {
      const chat = createChatSession(db, { paperSlug: slug, backend: 'codex' })
      addChatMessage(db, { sessionId: chat.id, role: 'user', content: 'Legacy DOI question' })
      const first = await ingest('10.1234/foo/bar', { db, dataDir: tmpDir, client })
      if (matches) {
        expect(first.slug).toBe(slug)
        expect(first.paths).toEqual({ pdfPath, mdPath })
        expect(readFileSync(pdfPath)).toEqual(incoming)
      } else {
        expect(first.slug).not.toBe(slug)
        expect(getPaper(db, slug)?.title).toBe('Legacy DOI')
        expect(readFileSync(pdfPath)).toEqual(oldBytes)
        expect(readFileSync(mdPath, 'utf8')).toBe('# Legacy DOI paper')
        expect(getNote(db, first.slug)).toBeUndefined()
        expect(getLatestChatSession(db, first.slug)).toBeUndefined()
      }
      db.close()
      db = openDb({ path: dbPath })
      const repeated = await ingest('http://dx.doi.org/10.1234/FOO%2FBAR', { db, dataDir: tmpDir, client })
      expect(repeated.slug).toBe(first.slug)
      expect(listPapers(db)).toHaveLength(matches ? 1 : 2)
      expect(getNote(db, slug)?.body).toBe('Legacy DOI research')
      expect(getChatMessages(db, chat.id).map(message => message.content)).toEqual(['Legacy DOI question'])
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

  it('leaves existing paper files, database and notes unchanged when a DOI returns HTML', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const db = openDb({ path: ':memory:' })
    const doi = '10.1371/journal.pone.0000308'
    stubCrossrefFetch(readFileSync(FIXTURE_PDF))

    try {
      const paper = await ingest(doi, {
        db, dataDir: tmpDir, client: new FakeClient([textUpdate(AGENT_JSON), doneUpdate]),
      })
      const note = upsertNote(db, paper.slug, 'Keep this research note.')
      const rows = listPapers(db)
      const pdf = readFileSync(paper.paths.pdfPath)
      const markdown = readFileSync(paper.paths.mdPath)
      const database = db.serialize()
      const client = new FakeClient()
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('api.crossref.org/works/')) {
          return new Response(CROSSREF_ORCID_BODY)
        }
        return new Response('<html>Publisher landing page</html>', {
          headers: { 'content-type': 'text/html;charset=UTF-8' },
        })
      }))

      await expect(ingest(doi, { db, dataDir: tmpDir, client }))
        .rejects.toThrow(/DOI PDF resolved to a web page.*direct PDF URL/)
      expect(client.session).toBeUndefined()
      expect(listPapers(db)).toEqual(rows)
      expect(getNote(db, paper.slug)).toEqual(note)
      expect(db.serialize()).toEqual(database)
      expect(readFileSync(paper.paths.pdfPath)).toEqual(pdf)
      expect(readFileSync(paper.paths.mdPath)).toEqual(markdown)
    } finally {
      db.close()
      vi.unstubAllGlobals()
    }
  })

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

  it('keeps a re-ingested paper in Trash until explicit restore, persisting both states across reopen', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const dbPath = join(tmpDir, 'app.db')
    let db = openDb({ path: dbPath })

    try {
      const first = await ingest(FIXTURE_PDF, {
        db, dataDir: tmpDir, client: new FakeClient([textUpdate(AGENT_JSON), doneUpdate]),
      })
      const trashedAt = trashPaper(db, first.slug)?.trashedAt
      expect(trashedAt).toBeTruthy()

      const second = await ingest(FIXTURE_PDF, {
        db, dataDir: tmpDir, client: new FakeClient([textUpdate(AGENT_JSON), doneUpdate]),
      })

      expect(second.slug).toBe(first.slug)
      expect(getPaper(db, first.slug)?.trashedAt).toBe(trashedAt)
      expect(listPapers(db)).toEqual([])
      expect(listPapers(db, { trashed: true }).map((paper) => paper.slug)).toEqual([first.slug])

      db.close()
      db = openDb({ path: dbPath })
      expect(getPaper(db, first.slug)?.trashedAt).toBe(trashedAt)
      expect(listPapers(db)).toEqual([])

      expect(restorePaper(db, first.slug)?.trashedAt).toBeUndefined()
      db.close()
      db = openDb({ path: dbPath })
      expect(getPaper(db, first.slug)?.trashedAt).toBeUndefined()
      expect(listPapers(db).map((paper) => paper.slug)).toEqual([first.slug])
      expect(listPapers(db, { trashed: true })).toEqual([])
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

  it('re-ingests legacy aliases without losing research or reconciling historical generic imports', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'))
    const dbPath = join(tmpDir, 'app.db')
    let db = openDb({ path: dbPath })
    const pdf = readFileSync(FIXTURE_PDF)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://export.arxiv.org/api/query?id_list=math%2F0309136') {
        return new Response('<feed><entry><title>Regular points in affine Springer fibers</title><author><name>Author</name></author><published>2003-09-01</published></entry></feed>')
      }
      if (url === 'https://export.arxiv.org/pdf/math%2F0309136') {
        return new Response(new Uint8Array(pdf))
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    try {
      // A pre-fix generic import remains independently addressable, with its
      // original files and research. No implicit migration is part of ingest.
      const generic = await ingest(FIXTURE_PDF, { db, dataDir: tmpDir, client: new FakeClient() })
      upsertPaper(db, { ...getPaper(db, generic.slug)!, slug: 'pdf-0309136' })
      const genericPaper = getPaper(db, 'pdf-0309136')
      const genericNote = upsertNote(db, 'pdf-0309136', 'Historical PDF research')
      const first = await ingest('math.AG/0309136', { db, dataDir: tmpDir, client: new FakeClient() })
      expect(first.slug).toBe('arxiv-math-0309136')
      expect(first.title).toBe('Regular points in affine Springer fibers')
      const note = upsertNote(db, first.slug, 'Keep canonical research')
      const highlight = createHighlight(db, {
        id: 'legacy-highlight', paperSlug: first.slug, page: 1, color: 'yellow',
        quote: 'Sample', anchor: '{}', createdAt: '2026-11-05T00:00:00.000Z',
      })
      const chat = createChatSession(db, { paperSlug: first.slug, backend: 'codex' })
      const message = addChatMessage(db, { sessionId: chat.id, role: 'user', content: 'Explain this result' })
      const collection = createCollection(db, { name: 'Legacy research' })
      assignPaperToCollection(db, { paperSlug: first.slug, collectionId: collection.id })

      const second = await ingest('https://arxiv.org/pdf/math/0309136.pdf', {
        db, dataDir: tmpDir, client: new FakeClient(),
      })
      expect(second.paths).toEqual(first.paths)
      expect(second.slug).toBe(first.slug)
      db.close()
      db = openDb({ path: dbPath })
      expect(listPapers(db).filter(p => p.arxivId === 'math/0309136')).toHaveLength(1)
      expect(getNote(db, first.slug)).toEqual(note)
      expect(listHighlights(db, first.slug)).toEqual([highlight])
      expect(getChatSession(db, chat.id)).toEqual(chat)
      expect(getChatMessages(db, chat.id)).toEqual([message])
      expect(listPaperCollections(db, first.slug)).toEqual([collection])
      expect(getPaper(db, 'pdf-0309136')).toEqual(genericPaper)
      expect(getNote(db, 'pdf-0309136')).toEqual(genericNote)
      expect(readFileSync(generic.paths.pdfPath)).toEqual(pdf)
    } finally {
      db.close()
      vi.unstubAllGlobals()
    }
  })
})
