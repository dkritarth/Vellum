import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fetchSource, fetchPdfFromUrl, DEFAULT_MAX_PDF_BYTES } from './fetch'
import type { ClassifiedInput } from './classify'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

const ARXIV_ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <published>2024-01-22T18:00:00Z</published>
    <title>  Attention Is All You Need, Again  </title>
    <summary>  This paper revisits attention mechanisms.  </summary>
    <author><name>Jane Doe</name></author>
    <author><name>John Smith</name></author>
    <arxiv:journal_ref>NeurIPS 2024</arxiv:journal_ref>
  </entry>
</feed>`

const CROSSREF_FIXTURE = {
  message: {
    title: ['Deep Learning for Everyone'],
    author: [
      { given: 'Ada', family: 'Lovelace' },
      { given: 'Alan', family: 'Turing' },
    ],
    published: { 'date-parts': [[2022, 5, 1]] },
    'container-title': ['Journal of Made-Up Science'],
    abstract: '<jats:p>A survey of things.</jats:p>',
  },
}

const CROSSREF_FIXTURE_WITH_ORCIDS = {
  message: {
    title: ['ORCID-Bearing Paper'],
    author: [
      { given: 'Ada', family: 'Lovelace', ORCID: 'http://orcid.org/0000-0002-1825-0097' },
      { given: 'Alan', family: 'Turing' },
      { given: 'Grace', family: 'Hopper', ORCID: 'https://orcid.org/0000-0001-5109-3700/' },
    ],
    published: { 'date-parts': [[2023, 1, 1]] },
    'container-title': ['Journal of Reproducible Authorship'],
  },
}

describe('fetchSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches arXiv PDF bytes + metadata from the arXiv API', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('export.arxiv.org/api/query')) {
        return Promise.resolve(new Response(ARXIV_ATOM_FIXTURE, { status: 200 }))
      }
      if (url.includes('export.arxiv.org/pdf/')) {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const input: ClassifiedInput = { kind: 'arxiv', slug: 'arxiv-2401.12345', value: '2401.12345' }
    const result = await fetchSource(input, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] })

    expect(result.pdfBytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(result.metadata).toEqual({
      title: 'Attention Is All You Need, Again',
      authors: ['Jane Doe', 'John Smith'],
      year: 2024,
      venue: 'NeurIPS 2024',
      abstract: 'This paper revisits attention mechanisms.',
    })
    expect(result.metadata?.authorOrcids).toBeUndefined()

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calledUrls.some((u) => u.includes('id_list=2401.12345'))).toBe(true)
  })

  it('fetches DOI metadata from Crossref and PDF bytes from the DOI URL', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('api.crossref.org/works/')) {
        return Promise.resolve(
          new Response(JSON.stringify(CROSSREF_FIXTURE), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      if (url.startsWith('https://doi.org/')) {
        return Promise.resolve(new Response(new Uint8Array([9, 9]), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const input: ClassifiedInput = {
      kind: 'doi',
      slug: 'doi-10.1038-s41586-021-03819-2',
      value: '10.1038/s41586-021-03819-2',
    }
    const result = await fetchSource(input, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] })

    expect(result.pdfBytes).toEqual(new Uint8Array([9, 9]))
    expect(result.metadata).toEqual({
      title: 'Deep Learning for Everyone',
      authors: ['Ada Lovelace', 'Alan Turing'],
      year: 2022,
      venue: 'Journal of Made-Up Science',
      abstract: 'A survey of things.',
    })
    expect(result.metadata?.authorOrcids).toBeUndefined()

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(
      calledUrls.some((u) => u.includes('api.crossref.org/works/10.1038%2Fs41586-021-03819-2')),
    ).toBe(true)
  })

  it('extracts and bare-normalizes ORCIDs from Crossref, positionally aligned with nulls for authors with none', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('api.crossref.org/works/')) {
        return Promise.resolve(
          new Response(JSON.stringify(CROSSREF_FIXTURE_WITH_ORCIDS), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      if (url.startsWith('https://doi.org/')) {
        return Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const input: ClassifiedInput = {
      kind: 'doi',
      slug: 'doi-orcid-test',
      value: '10.1/orcid-test',
    }
    const result = await fetchSource(input, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] })

    expect(result.metadata?.authors).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper'])
    expect(result.metadata?.authorOrcids).toEqual([
      '0000-0002-1825-0097',
      null,
      '0000-0001-5109-3700',
    ])
  })

  it('rejects a DOI publisher landing page with a direct-PDF or local-file remedy', async () => {
    const landingPage = 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000308'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.crossref.org/works/')) {
        return Response.json(CROSSREF_FIXTURE)
      }
      if (url.startsWith('https://doi.org/')) {
        return new Response(null, { status: 302, headers: { location: landingPage } })
      }
      return new Response('<html>Publisher landing page</html>', {
        headers: { 'content-type': 'text/html;charset=UTF-8' },
      })
    })

    await expect(fetchSource({
      kind: 'doi', slug: 'doi-plos', value: '10.1371/journal.pone.0000308',
    }, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
      .rejects.toThrow('DOI PDF resolved to a web page, not a PDF. Supply a direct PDF URL or download the PDF and import the local file.')
  })

  it('fetches raw PDF bytes for a direct pdf_url with no metadata', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://example.com/paper.pdf') {
        return Promise.resolve(new Response(new Uint8Array([5, 5, 5]), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const input: ClassifiedInput = { kind: 'pdf_url', slug: 'pdf-paper', value: 'https://example.com/paper.pdf' }
    const result = await fetchSource(input, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] })

    expect(result.pdfBytes).toEqual(new Uint8Array([5, 5, 5]))
    expect(result.metadata).toBeUndefined()
  })

  it('reads raw PDF bytes for a local_pdf path with no metadata (no network call)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'vellum-fetch-'))
    const pdfPath = join(tmpDir, 'local.pdf')
    writeFileSync(pdfPath, Buffer.from([7, 7, 7]))

    const input: ClassifiedInput = { kind: 'local_pdf', slug: 'local-local', value: pdfPath }
    const result = await fetchSource(input, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] })

    expect(Array.from(result.pdfBytes)).toEqual([7, 7, 7])
    expect(result.metadata).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws when the arXiv API returns a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    const input: ClassifiedInput = { kind: 'arxiv', slug: 'arxiv-9999.99999', value: '9999.99999' }
    await expect(fetchSource(input)).rejects.toThrow(/arXiv/)
  })

  it('throws when Crossref returns a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    const input: ClassifiedInput = { kind: 'doi', slug: 'doi-x', value: '10.1/doesnotexist' }
    await expect(fetchSource(input)).rejects.toThrow(/Crossref/)
  })

  // A metadata server that accepts the connection but never answers must not
  // hang ingest forever: metadata requests honor the same timeout as the PDF.
  function hangUntilAborted(_url: string, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return // no signal: hang forever (the bug)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }

  it('times out a hung Crossref metadata request', { timeout: 2000 }, async () => {
    fetchMock.mockImplementation(hangUntilAborted)
    const input: ClassifiedInput = { kind: 'doi', slug: 'doi-hang', value: '10.1/hang' }
    await expect(fetchSource(input, { timeoutMs: 50 })).rejects.toThrow(/Crossref.*timed out after 50ms/)
  })

  it('times out a hung arXiv metadata request', { timeout: 2000 }, async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('https://export.arxiv.org/pdf/')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      }
      return hangUntilAborted(url, init)
    })
    const input: ClassifiedInput = { kind: 'arxiv', slug: 'arxiv-2401.00001', value: '2401.00001' }
    await expect(
      fetchSource(input, {
        timeoutMs: 50,
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
    ).rejects.toThrow(/arXiv API.*timed out after 50ms/)
  })
})

describe('fetchSource local PDF limits', () => {
  let dir: string
  let input: ClassifiedInput

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vellum-local-limit-'))
    input = { kind: 'local_pdf', slug: 'local-paper', value: join(dir, 'paper.pdf') }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a regular file one byte over the configured cap', async () => {
    writeFileSync(input.value, new Uint8Array([1, 2, 3, 4, 5]))
    await expect(fetchSource(input, { maxBytes: 4 })).rejects.toThrow(
      'Local PDF exceeds maximum allowed size of 4 bytes',
    )
  })

  it.each([3, 4])('preserves all %i bytes at or below a four-byte cap', async (size) => {
    const bytes = new Uint8Array([1, 2, 3, 4]).slice(0, size)
    writeFileSync(input.value, bytes)
    await expect(fetchSource(input, { maxBytes: 4 })).resolves.toEqual({
      pdfBytes: bytes, metadata: undefined,
    })
  })

  it('accepts an empty regular file at a zero-byte cap', async () => {
    writeFileSync(input.value, '')
    expect((await fetchSource(input, { maxBytes: 0 })).pdfBytes).toHaveLength(0)
  })

  it('rejects a sparse file above the default 50 MiB cap and closes without reading', async () => {
    writeFileSync(input.value, '')
    truncateSync(input.value, DEFAULT_MAX_PDF_BYTES + 1)
    const handle = await fs.open(input.value, 'r')
    vi.mocked(fs.open).mockResolvedValueOnce(handle)
    const read = vi.spyOn(handle, 'read')
    try {
      await expect(fetchSource(input)).rejects.toThrow('maximum allowed size of 52428800 bytes')
      expect(read).not.toHaveBeenCalled()
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })

  it('rejects a directory before reading and closes its handle', async () => {
    // Windows rejects opening directories itself; exercise handle cleanup on POSIX.
    if (process.platform === 'win32') {
      await expect(fetchSource({ ...input, value: dir })).rejects.toThrow()
      return
    }
    const handle = await fs.open(dir, 'r')
    vi.mocked(fs.open).mockResolvedValueOnce(handle)
    const read = vi.spyOn(handle, 'read')
    try {
      await expect(fetchSource({ ...input, value: dir })).rejects.toThrow('must be a regular file')
      expect(read).not.toHaveBeenCalled()
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })

  it.skipIf(process.platform === 'win32')('rejects a FIFO without waiting for a writer', async () => {
    execFileSync('mkfifo', [input.value])
    await expect(fetchSource(input)).rejects.toThrow('must be a regular file')
  })

  it.each(['stat', 'read'] as const)('closes the handle when %s fails', async (operation) => {
    writeFileSync(input.value, 'paper')
    const handle = await fs.open(input.value, 'r')
    vi.mocked(fs.open).mockResolvedValueOnce(handle)
    vi.spyOn(handle, operation).mockRejectedValueOnce(new Error('disk failure'))
    try {
      await expect(fetchSource(input)).rejects.toThrow('disk failure')
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })

  it('propagates a missing-file error', async () => {
    await expect(fetchSource(input)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves bytes across multiple reads and closes on success', async () => {
    const bytes = new Uint8Array(65_537).fill(7)
    bytes[65_536] = 9
    writeFileSync(input.value, bytes)
    const handle = await fs.open(input.value, 'r')
    vi.mocked(fs.open).mockResolvedValueOnce(handle)
    try {
      expect((await fetchSource(input, { maxBytes: bytes.length })).pdfBytes).toEqual(bytes)
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })

  it('rejects growth beyond the cap after the size check and closes the file', async () => {
    writeFileSync(input.value, new Uint8Array([1, 2, 3, 4]))
    const handle = await fs.open(input.value, 'r')
    const stat = await handle.stat()
    vi.mocked(fs.open).mockResolvedValueOnce(handle)
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      // Deterministic filesystem race: grow the real file after capturing its size.
      writeFileSync(input.value, new Uint8Array([1, 2, 3, 4, 5]))
      return stat
    })
    try {
      await expect(fetchSource(input, { maxBytes: 4 })).rejects.toThrow(
        'Local PDF exceeds maximum allowed size of 4 bytes',
      )
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })
})

describe('fetchPdfFromUrl security and resource limits', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['text/html', 'TeXt/HtMl; charset=UTF-8', 'application/xhtml+xml', 'Application/XHTML+XML; charset=utf-8'])(
    'rejects %s without reading the body and cancels it', async (contentType) => {
      const pull = vi.fn()
      const cancel = vi.fn()
      const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
      fetchMock.mockResolvedValue(new Response(body, {
        headers: { 'content-type': contentType },
      }))

      await expect(fetchPdfFromUrl('https://example.com/paper.pdf', 'PDF URL', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      })).rejects.toThrow(/web page.*direct PDF URL.*import the local file/)
      expect(pull).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledOnce()
    },
  )

  it.each([undefined, 'application/octet-stream', 'application/pdf; charset=binary'])(
    'preserves PDF bytes with content type %s', async (contentType) => {
      const pdf = new TextEncoder().encode('%PDF-1.4\n')
      fetchMock.mockResolvedValue(new Response(pdf, {
        headers: contentType ? { 'content-type': contentType } : {},
      }))

      await expect(fetchPdfFromUrl('https://example.com/paper.pdf', 'PDF URL', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      })).resolves.toEqual(pdf)
    },
  )

  describe('SSRF protection', () => {
    it('rejects loopback IPv4 addresses', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-loopback', value: 'http://127.0.0.1:8080/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-loopback-2', value: 'http://127.0.0.2/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
    })

    it('rejects private LAN IPv4 ranges (10.x, 192.168.x, 172.16-31.x)', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-private-10', value: 'http://10.0.0.1/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-private-192', value: 'http://192.168.1.1/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-private-172', value: 'http://172.16.0.1/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
    })

    it('rejects cloud metadata IPv4 address (169.254.169.254)', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-metadata', value: 'http://169.254.169.254/latest/meta-data/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
    })

    it('rejects loopback and private IPv6 addresses', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-v6-loopback', value: 'http://[::1]:8080/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-v6-mapped', value: 'http://[::ffff:127.0.0.1]/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-v6-ula', value: 'http://[fc00::1]/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
      await expect(
        fetchSource({ kind: 'pdf_url', slug: 'pdf-v6-linklocal', value: 'http://[fe80::1]/paper.pdf' }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
    })

    it('rejects non-http and non-https schemes', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      await expect(
        fetchPdfFromUrl('file:///etc/passwd'),
      ).rejects.toThrow(/protocol|scheme/i)
      await expect(
        fetchPdfFromUrl('ftp://example.com/paper.pdf'),
      ).rejects.toThrow(/protocol|scheme/i)
      await expect(
        fetchPdfFromUrl('gopher://evil.com/paper.pdf'),
      ).rejects.toThrow(/protocol|scheme/i)
    })

    it('rejects hostnames that resolve to private/loopback addresses via DNS', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      const fakeLookup = async () => [{ address: '127.0.0.1', family: 4 }]
      await expect(
        fetchPdfFromUrl('https://malicious-dns.com/paper.pdf', 'PDF URL', {
          lookup: fakeLookup,
        }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
    })

    it('refuses redirects to private or loopback destination addresses', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url === 'https://public-site.org/paper.pdf') {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: 'http://169.254.169.254/latest/meta-data' },
            }),
          )
        }
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      })

      const fakeLookup = async (host: string) => {
        if (host === 'public-site.org') return [{ address: '93.184.216.34', family: 4 }]
        return [{ address: '169.254.169.254', family: 4 }]
      }

      await expect(
        fetchPdfFromUrl('https://public-site.org/paper.pdf', 'PDF URL', {
          lookup: fakeLookup,
        }),
      ).rejects.toThrow(/forbidden|blocked|private|loopback/i)
    })
  })

  describe('Timeout enforcement', () => {
    it('times out and aborts when the request hangs longer than timeoutMs', async () => {
      fetchMock.mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
            })
          }),
      )

      const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }]
      await expect(
        fetchPdfFromUrl('https://public-site.org/paper.pdf', 'PDF URL', {
          timeoutMs: 50,
          lookup: fakeLookup,
        }),
      ).rejects.toThrow(/timed out/i)
    })
  })

  describe('Unbounded buffering protection', () => {
    it('rejects early when Content-Length exceeds max allowed bytes', async () => {
      fetchMock.mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '60000000' },
        }),
      )

      const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }]
      await expect(
        fetchPdfFromUrl('https://public-site.org/paper.pdf', 'PDF URL', {
          maxBytes: 50 * 1024 * 1024,
          lookup: fakeLookup,
        }),
      ).rejects.toThrow(/maximum.*size|exceeds/i)
    })

    it('aborts and rejects when streaming body exceeds max allowed bytes', async () => {

      let cancelled = false
      const stream = new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(20 * 1024 * 1024))
        },
        cancel() {
          cancelled = true
        },
      })

      fetchMock.mockResolvedValue(
        new Response(stream, {
          status: 200,
        }),
      )

      const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }]
      await expect(
        fetchPdfFromUrl('https://public-site.org/paper.pdf', 'PDF URL', {
          maxBytes: 50 * 1024 * 1024,
          lookup: fakeLookup,
        }),
      ).rejects.toThrow(/maximum.*size|exceeds/i)

      expect(cancelled).toBe(true)
    })
  })

  describe('Legitimate URL acceptance', () => {
    it('successfully accepts and downloads PDF from a legitimate public HTTPS URL', async () => {
      const expectedBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
      fetchMock.mockResolvedValue(
        new Response(expectedBytes, {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'content-length': '8' },
        }),
      )

      const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }]
      const bytes = await fetchPdfFromUrl('https://safe-papers.org/paper.pdf', 'PDF URL', {
        lookup: fakeLookup,
      })

      expect(bytes).toEqual(expectedBytes)
    })
  })
})
