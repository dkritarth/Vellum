// Convert raw PDF bytes (from fetch.ts's FetchedSource.pdfBytes) into
// paper.md-shaped markdown. Pure text-layer extraction — no OCR, no layout
// engine. Uses `unpdf` (thin, dependency-free wrapper around a
// serverless-friendly PDF.js build) rather than driving `pdfjs-dist`
// directly: same extraction quality, far less boilerplate (worker setup,
// canvas factory, module resolution) for a Node/Electron main-process
// context that never needs to render pages to a canvas. See README.md for
// the full trade-off.
//
// Heuristic: PDF.js reports each text run's font size (derived from its
// transform matrix). The most common size on the page is body text; runs
// noticeably larger are headings. This is a structural guess, not a real
// layout parse — good enough to make paper.md skimmable and greppable by an
// agent, not a faithful re-typeset of the PDF.

import { extractTextItems } from 'unpdf'

const H1_RATIO = 1.8
const H2_RATIO = 1.15

/**
 * Convert PDF bytes to markdown. Headings are inferred from relative font
 * size (see module comment); everything else is emitted as body paragraphs
 * in reading order. Throws if the PDF has no extractable text layer (e.g.
 * empty input or a scanned/image-only PDF — this is text-layer extraction,
 * not OCR).
 */
export async function convertPdfToMarkdown(pdfBytes: Uint8Array): Promise<string> {
  if (pdfBytes.length === 0) {
    throw new Error('convertPdfToMarkdown: empty PDF bytes')
  }

  const { items } = await extractTextItems(pdfBytes)

  const lines = items
    .flat()
    .map((item) => ({ text: item.str.trim(), fontSize: item.fontSize }))
    .filter((line) => line.text.length > 0)

  if (lines.length === 0) {
    throw new Error(
      'convertPdfToMarkdown: no extractable text layer (scanned/image-only PDF is out of scope — this is text extraction, not OCR)',
    )
  }

  const bodyFontSize = modeFontSize(lines.map((l) => l.fontSize))

  const blocks: string[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(paragraph.join(' '))
      paragraph = []
    }
  }

  for (const line of lines) {
    const heading = headingPrefix(line.fontSize, bodyFontSize)
    if (heading) {
      flushParagraph()
      blocks.push(`${heading}${line.text}`)
    } else {
      paragraph.push(line.text)
    }
  }
  flushParagraph()

  return blocks.join('\n\n') + '\n'
}

function headingPrefix(fontSize: number, bodyFontSize: number): string | undefined {
  if (bodyFontSize <= 0) return undefined
  const ratio = fontSize / bodyFontSize
  if (ratio >= H1_RATIO) return '# '
  if (ratio >= H2_RATIO) return '## '
  return undefined
}

/** Most frequent font size among body text lines — used as the "normal
 * text" baseline that heading sizes are compared against. */
function modeFontSize(sizes: number[]): number {
  const counts = new Map<number, number>()
  for (const size of sizes) {
    counts.set(size, (counts.get(size) ?? 0) + 1)
  }
  let best = sizes[0]
  let bestCount = 0
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size
      bestCount = count
    }
  }
  return best
}
