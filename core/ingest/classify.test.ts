import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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
    slug: string | RegExp
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
      slug: /^doi-10\.1038-s41586-021-03819-2-[a-f0-9]{64}$/,
      value: '10.1038/s41586-021-03819-2',
    },
    {
      name: 'doi.org URL',
      input: () => 'https://doi.org/10.1038/s41586-021-03819-2',
      kind: 'doi',
      slug: /^doi-10\.1038-s41586-021-03819-2-[a-f0-9]{64}$/,
      value: '10.1038/s41586-021-03819-2',
    },
    {
      name: 'dx.doi.org URL',
      input: () => 'https://dx.doi.org/10.1145/3292500.3330701',
      kind: 'doi',
      slug: /^doi-10\.1145-3292500\.3330701-[a-f0-9]{64}$/,
      value: '10.1145/3292500.3330701',
    },
    {
      name: 'direct https PDF URL',
      input: () => 'https://example.com/papers/foo-bar.pdf',
      kind: 'pdf_url',
      slug: /^pdf-foo-bar-[a-f0-9]{64}$/,
    },
    {
      name: 'direct http PDF URL with query string',
      input: () => 'http://example.com/papers/report.pdf?download=1',
      kind: 'pdf_url',
      slug: /^pdf-report-[a-f0-9]{64}$/,
    },
  ]

  it.each(cases)('classifies $name', ({ input, kind, slug, value }) => {
    const result = classifyInput(input())
    expect(result.kind).toBe(kind)
    if (typeof slug === 'string') expect(result.slug).toBe(slug)
    else expect(result.slug).toMatch(slug)
    if (value !== undefined) {
      expect(result.value).toBe(value)
    }
  })

  it('keeps colliding DOI punctuation distinct with bounded stable identities', () => {
    const slash = classifyInput('10.1234/foo/bar')
    const hyphen = classifyInput('10.1234/foo-bar')
    expect(slash.slug).not.toBe(hyphen.slug)
    expect(slash.legacySlug).toBe('doi-10.1234-foo-bar')
    expect(hyphen.legacySlug).toBe(slash.legacySlug)
    expect(classifyInput('10.1234/' + 'a'.repeat(1000)).slug.length).toBeLessThanOrEqual(145)
    for (const equivalent of ['10.1234/FOO/BAR', 'https://doi.org/10.1234/foo/bar',
      'http://dx.doi.org/10.1234/FOO%2FBAR']) {
      expect(classifyInput(equivalent)).toEqual(slash)
    }
  })

  it('classifies a local filesystem path to a .pdf', () => {
    const result = classifyInput(localPdfPath)
    expect(result.kind).toBe('local_pdf')
    expect(result.slug).toMatch(/^local-my-paper-[a-f0-9]{64}$/)
    expect(result.value).toBe(localPdfPath)
  })


  it('normalizes equivalent local paths and URL fragments without discarding source query parameters', () => {
    expect(classifyInput(relative(process.cwd(), localPdfPath))).toEqual(classifyInput(localPdfPath))
    const source = classifyInput('https://EXAMPLE.com:443/paper.pdf?paper=alpha#page=1')
    expect(source).toEqual(classifyInput('https://example.com/paper.pdf?paper=alpha#page=9'))
    expect(source.slug).not.toBe(classifyInput('https://example.com/paper.pdf?paper=beta').slug)
    expect(source.slug).not.toBe(classifyInput('https://another.example.com/paper.pdf?paper=alpha').slug)
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
    // Generic PDF slugs carry a location hash (#96); the legacy slug keeps the old shape.
    expect(classifyInput('https://example.com/pdf/hep-th/9905111.pdf')).toMatchObject({
      kind: 'pdf_url', value: 'https://example.com/pdf/hep-th/9905111.pdf', legacySlug: 'pdf-9905111',
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

  // Link forms people paste (overnight ingest review).
  it('routes arXiv DOIs to arXiv, bare or as a URL', () => {
    for (const input of ['10.48550/arXiv.1706.03762', 'https://doi.org/10.48550/arXiv.1706.03762', 'https://doi.org/10.48550/ARXIV.1706.03762v7']) {
      const result = classifyInput(input)
      expect(result.kind).toBe('arxiv')
      expect(result.value).toMatch(/^1706\.03762(v7)?$/)
    }
    expect(classifyInput('10.48550/arXiv.hep-th/9901001').value).toBe('hep-th/9901001')
  })

  it('ignores query strings and fragments on arXiv links', () => {
    for (const input of [
      'https://arxiv.org/abs/1706.03762?context=cs.LG',
      'https://arxiv.org/abs/1706.03762#abstract',
      'https://arxiv.org/pdf/1706.03762v7.pdf?download=1',
      'https://arxiv.org/abs/hep-th/9901001v2?context=hep-th',
    ]) {
      const result = classifyInput(input)
      expect(result.kind).toBe('arxiv')
    }
    expect(classifyInput('https://arxiv.org/pdf/1706.03762v7.pdf?download=1').value).toBe('1706.03762v7')
  })

  it('ignores query strings and fragments on DOI links', () => {
    const plain = classifyInput('https://doi.org/10.1038/s41586-021-03819-2')
    for (const input of ['https://doi.org/10.1038/s41586-021-03819-2?utm_source=x', 'https://doi.org/10.1038/s41586-021-03819-2#sec1']) {
      expect(classifyInput(input)).toEqual(plain)
    }
  })

  it('rejects malformed DOI URL escapes with a clear message', () => {
    expect(() => classifyInput('https://doi.org/10.1000/foo%zz')).toThrow('classifyInput: malformed DOI URL')
  })

  it('accepts file:// URLs to local PDFs', () => {
    const url = new URL(`file://${localPdfPath}`).href
    const result = classifyInput(url)
    expect(result).toEqual(classifyInput(localPdfPath))
  })
})
