import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertPdfToMarkdown } from './convert'

const fixturePath = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url))

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
})
