import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchSource } from './fetch'
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
    const result = await fetchSource(input)

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
    const result = await fetchSource(input)

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
    const result = await fetchSource(input)

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
    const result = await fetchSource(input)

    expect(result.pdfBytes).toEqual(new Uint8Array([5, 5, 5]))
    expect(result.metadata).toBeUndefined()
  })

  it('reads raw PDF bytes for a local_pdf path with no metadata (no network call)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'vellum-fetch-'))
    const pdfPath = join(tmpDir, 'local.pdf')
    writeFileSync(pdfPath, Buffer.from([7, 7, 7]))

    const input: ClassifiedInput = { kind: 'local_pdf', slug: 'local-local', value: pdfPath }
    const result = await fetchSource(input)

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
