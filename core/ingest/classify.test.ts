import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyInput } from './classify'
import { assertValidSlug } from '../library/slug'

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

  it('normalizes legacy identifier and URL aliases to one safe arXiv identity', () => {
    for (const input of [
      'hep-th/9905111',
      ' HEP-TH/9905111 ',
      'hep-th/9905111.pdf',
      'https://arxiv.org/abs/hep-th/9905111',
      'https://arxiv.org/pdf/hep-th/9905111.pdf',
      'http://www.arxiv.org/pdf/HEP-TH/9905111/',
    ]) {
      const result = classifyInput(input)
      expect(result).toEqual({ kind: 'arxiv', value: 'hep-th/9905111', slug: 'arxiv-hep-th-9905111' })
      expect(() => assertValidSlug(result.slug)).not.toThrow()
    }
  })

  it.each([
    'math/0309136v3',
    'math.AG/0309136v3',
    'MATH.ag/0309136V3.pdf',
    'https://arxiv.org/abs/math.AG/0309136v3/',
    'http://www.arxiv.org/pdf/math.AG/0309136v3.pdf',
  ])('retains version and removes redundant subject class: %s', (input) => {
    expect(classifyInput(input)).toEqual({
      kind: 'arxiv', value: 'math/0309136v3', slug: 'arxiv-math-0309136v3',
    })
  })

  it('retains legacy versions in hyphenated archive slugs', () => {
    expect(classifyInput('https://arxiv.org/pdf/hep-th/9905111v3.pdf')).toEqual({
      kind: 'arxiv', value: 'hep-th/9905111v3', slug: 'arxiv-hep-th-9905111v3',
    })
  })

  it('preserves four-digit modern sequence numbers and slugs', () => {
    expect(classifyInput('https://arxiv.org/pdf/0704.0001v2.pdf')).toEqual({
      kind: 'arxiv', value: '0704.0001v2', slug: 'arxiv-0704.0001v2',
    })
  })

  it.each([
    '../9905111', 'hep-th/../9905111', 'hep-th//9905111',
    'hep-th/990511', 'hep-th/99051111', 'hep-th/9913111', 'hep-th/9905000',
    'hep-th/9905111v0', 'hep-th/9905111v01', 'hep-th/9905111v-1',
    'hep-th/9905111v', 'hep-th/9905111/extra', 'math.A/0309136',
    'math.AGG/0309136', 'math/0309136?query', 'hep-th%2F9905111',
    'https://arxiv.org/abs/hep-th/../9905111',
    'https://arxiv.org/abs/hep-th%2F9905111',
    'https://arxiv.org.evil.example/abs/hep-th/9905111',
    'https://arxiv.org@evil.example/abs/hep-th/9905111',
  ])('rejects malformed or unsafe legacy identifiers: %s', (input) => {
    expect(() => classifyInput(input)).toThrow()
  })

  it('keeps unrelated PDF hosts on the generic PDF path', () => {
    expect(classifyInput('https://example.com/pdf/hep-th/9905111.pdf')).toEqual({
      kind: 'pdf_url', value: 'https://example.com/pdf/hep-th/9905111.pdf', slug: 'pdf-9905111',
    })
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
