import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertPdfToMarkdown, guessPdfTitle, pickTitleFromTextRuns } from './convert'

const fixturePath = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url))

const fixture2Path = fileURLToPath(new URL('./fixtures/sample2.pdf', import.meta.url))

/** First H1 line of a converted paper.md — the title a live ingest run shows. */
function h1Title(markdown: string): string {
  const match = markdown.match(/^# (.+)$/m)
  if (!match?.[1]) throw new Error(`no H1 heading in converted markdown:\n${markdown}`)
  return match[1].trim()
}

describe('convertPdfToMarkdown', () => {
  it('converts a born-digital PDF into structured markdown (headings + body)', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))

    const markdown = await convertPdfToMarkdown(bytes)

    // Title promoted to an H1.
    expect(markdown).toMatch(/^# Sample Paper Title\s*$/m)

    // Section headings promoted to H2s, in document order.
    const introIdx = markdown.indexOf('## 1. Introduction')
    const methodIdx = markdown.indexOf('## 2. Method')
    const conclusionIdx = markdown.indexOf('## 3. Conclusion')
    expect(introIdx).toBeGreaterThan(-1)
    expect(methodIdx).toBeGreaterThan(introIdx)
    expect(conclusionIdx).toBeGreaterThan(methodIdx)

    // Body prose survives as plain paragraph text (not marked as a heading).
    expect(markdown).toContain(
      'This is the body text of the introduction section describing motivation and contributions.',
    )
    expect(markdown).toContain(
      'This section describes the method used in this research paper in plain prose.',
    )
    expect(markdown).toContain(
      'This section concludes the paper and summarizes the findings briefly.',
    )
  })

  it('throws a clear error for empty PDF bytes rather than returning empty markdown silently', async () => {
    await expect(convertPdfToMarkdown(new Uint8Array())).rejects.toThrow()
  })
  // Regression guard for #66: sample.pdf and sample2.pdf were byte-identical
  // (same md5), so both ingested to the same title and no live gate could tell
  // the two test papers apart by title.
  it('keeps the two fixtures distinguishable — distinct H1 titles', async () => {
    const [one, two] = await Promise.all([
      convertPdfToMarkdown(new Uint8Array(await readFile(fixturePath))),
      convertPdfToMarkdown(new Uint8Array(await readFile(fixture2Path))),
    ])

    expect(h1Title(one)).toBe('Sample Paper Title')
    expect(h1Title(two)).toBe('Sample Paper Two')
    expect(h1Title(one)).not.toBe(h1Title(two))
  })
})

describe('pickTitleFromTextRuns', () => {
  it('returns the largest-font text in reading order, skipping the arXiv margin stamp', () => {
    expect(
      pickTitleFromTextRuns([
        { str: 'arXiv:1706.03762v7 [cs.CL] 2 Aug 2023', fontSize: 20 },
        { str: 'Provided proper attribution is provided', fontSize: 10 },
        { str: 'Attention Is', fontSize: 17.2 },
        { str: 'All You Need', fontSize: 17.2 },
        { str: 'Ashish Vaswani', fontSize: 10 },
      ]),
    ).toBe('Attention Is All You Need')
  })

  it('returns undefined when the largest text is not word-like or there is no text', () => {
    expect(pickTitleFromTextRuns([{ str: '1', fontSize: 30 }, { str: 'body text', fontSize: 10 }])).toBeUndefined()
    expect(pickTitleFromTextRuns([{ str: '   ', fontSize: 12 }])).toBeUndefined()
    expect(pickTitleFromTextRuns([])).toBeUndefined()
  })

  it('caps very long titles', () => {
    const title = pickTitleFromTextRuns([{ str: 'Word '.repeat(200), fontSize: 18 }])
    expect(title?.length).toBeLessThanOrEqual(300)
    expect(title?.endsWith('…')).toBe(true)
  })
})

describe('guessPdfTitle', () => {
  it('reads the title from the first page of a real PDF', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    expect(await guessPdfTitle(bytes)).toBe('Sample Paper Title')
  })

  it('returns undefined instead of throwing for bytes that are not a PDF', async () => {
    expect(await guessPdfTitle(new TextEncoder().encode('not a pdf'))).toBeUndefined()
  })
})
