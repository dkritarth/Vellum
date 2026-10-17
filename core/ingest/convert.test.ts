import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertPdfToMarkdown } from './convert'

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
    expect(markdown).toMatch(/^# Attention Is All You Need\s*$/m)

    // Section headings promoted to H2s, in document order.
    const introIdx = markdown.indexOf('## 1. Introduction')
    const methodIdx = markdown.indexOf('## 2. Method')
    const conclusionIdx = markdown.indexOf('## 3. Conclusion')
    expect(introIdx).toBeGreaterThan(-1)
    expect(methodIdx).toBeGreaterThan(introIdx)
    expect(conclusionIdx).toBeGreaterThan(methodIdx)

    // Body prose survives as plain paragraph text (not marked as a heading).
    expect(markdown).toContain(
      'Recurrent neural networks have been firmly established as state of the art models in sequence modeling.',
    )
    expect(markdown).toContain(
      'Multi-head attention allows the model to jointly attend to information from different representation subspaces.',
    )
    expect(markdown).toContain(
      'We achieve state of the art results on translation tasks while cutting training time substantially.',
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

    expect(h1Title(one)).toBe('Attention Is All You Need')
    expect(h1Title(two)).toBe('Sample Paper Two')
    expect(h1Title(one)).not.toBe(h1Title(two))
  })
})
