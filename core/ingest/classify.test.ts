import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyInput } from './classify'

describe('classifyInput', () => {
  let tmpDir: string
  let localPdfPath: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vellum-classify-'))
    localPdfPath = join(tmpDir, 'My Paper.pdf')
    writeFileSync(localPdfPath, '%PDF-1.4 fake')
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const cases: Array<{
    name: string
    input: () => string
    kind: 'arxiv' | 'doi' | 'pdf_url' | 'local_pdf'
    slug: string
    value?: string
  }> = [
    {
      name: 'bare new-style arXiv id',
      input: () => '2401.12345',
      kind: 'arxiv',
      slug: 'arxiv-2401.12345',
      value: '2401.12345',
    },
    {
      name: 'bare arXiv id with version suffix',
      input: () => '2401.12345v2',
      kind: 'arxiv',
      slug: 'arxiv-2401.12345v2',
      value: '2401.12345v2',
    },
    {
      name: 'arxiv.org abs URL',
      input: () => 'https://arxiv.org/abs/2401.12345',
      kind: 'arxiv',
      slug: 'arxiv-2401.12345',
      value: '2401.12345',
    },
    {
      name: 'arxiv.org pdf URL',
      input: () => 'https://arxiv.org/pdf/2401.12345.pdf',
      kind: 'arxiv',
      slug: 'arxiv-2401.12345',
      value: '2401.12345',
    },
    {
      name: 'www.arxiv.org URL',
      input: () => 'http://www.arxiv.org/abs/2401.12345v1',
      kind: 'arxiv',
      slug: 'arxiv-2401.12345v1',
      value: '2401.12345v1',
    },
    {
      name: 'bare DOI',
      input: () => '10.1038/s41586-021-03819-2',
      kind: 'doi',
      slug: 'doi-10.1038-s41586-021-03819-2',
      value: '10.1038/s41586-021-03819-2',
    },
    {
      name: 'doi.org URL',
      input: () => 'https://doi.org/10.1038/s41586-021-03819-2',
      kind: 'doi',
      slug: 'doi-10.1038-s41586-021-03819-2',
      value: '10.1038/s41586-021-03819-2',
    },
    {
      name: 'dx.doi.org URL',
      input: () => 'https://dx.doi.org/10.1145/3292500.3330701',
      kind: 'doi',
      slug: 'doi-10.1145-3292500.3330701',
      value: '10.1145/3292500.3330701',
    },
    {
      name: 'direct https PDF URL',
      input: () => 'https://example.com/papers/foo-bar.pdf',
      kind: 'pdf_url',
      slug: 'pdf-foo-bar',
    },
    {
      name: 'direct http PDF URL with query string',
      input: () => 'http://example.com/papers/report.pdf?download=1',
      kind: 'pdf_url',
      slug: 'pdf-report',
    },
  ]

  it.each(cases)('classifies $name', ({ input, kind, slug, value }) => {
    const result = classifyInput(input())
    expect(result.kind).toBe(kind)
    expect(result.slug).toBe(slug)
    if (value !== undefined) {
      expect(result.value).toBe(value)
    }
  })

  it('classifies a local filesystem path to a .pdf', () => {
    const result = classifyInput(localPdfPath)
    expect(result.kind).toBe('local_pdf')
    expect(result.slug).toBe('local-my-paper')
    expect(result.value).toBe(localPdfPath)
  })

  it('rejects a local PDF path that does not exist', () => {
    expect(() => classifyInput(join(tmpDir, 'nope.pdf'))).toThrow(/not found/)
  })

  it('rejects an unrecognized URL', () => {
    expect(() => classifyInput('https://example.com/not-a-paper')).toThrow()
  })

  it('rejects empty input', () => {
    expect(() => classifyInput('   ')).toThrow()
  })

  it('produces filesystem-safe slugs (no slashes, uppercase, or spaces)', () => {
    const result = classifyInput('10.1038/S41586-021-03819-2')
    expect(result.slug).toMatch(/^[a-z0-9._-]+$/)
  })
})
