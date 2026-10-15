import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchSource, fetchPdfFromUrl } from './fetch'
import type { ClassifiedInput } from './classify'

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
