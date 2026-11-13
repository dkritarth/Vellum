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

import { extractTextItems, getDocumentProxy } from 'unpdf'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Replaced only by the main-process bundler; absent during source execution.
declare const __VELLUM_MAIN_BUNDLE__: boolean

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

  // Bundled CJS cannot rely on unpdf's import.meta.resolve default. Keep fonts
  // beside the main entry; source execution uses the installed package instead.
  const standardFontDirectory = typeof __VELLUM_MAIN_BUNDLE__ !== 'undefined' && __VELLUM_MAIN_BUNDLE__
    ? join(__dirname, 'pdfjs/standard_fonts')
    : fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts', import.meta.url))
  // unpdf 5.6's NodeBinaryDataFactory passes this string to fs.readFile.
  // It requires a filesystem path, unlike the renderer's DOM resource URLs.
  const document = await getDocumentProxy(pdfBytes, {
    standardFontDataUrl: standardFontDirectory + '/',
    disableFontFace: true,
  })
  let items: Awaited<ReturnType<typeof extractTextItems>>['items']
  try {
    items = (await extractTextItems(document)).items
  } finally {
    await document.destroy()
  }

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

const MAX_TITLE_LENGTH = 300
// arXiv stamps "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023" down the page margin
// in a font larger than the real title — never a title.
const ARXIV_STAMP = /^arxiv:\s*\S+/i

/**
 * Best-effort title from first-page text runs: the text set in the largest
 * font, in reading order. Returns undefined when nothing plausible is found.
 * Pure (no PDF parsing) so the heuristic is unit-testable on synthetic runs.
 */
export function pickTitleFromTextRuns(runs: { str: string; fontSize: number }[]): string | undefined {
  const candidates = runs
    .map((run) => ({ text: run.str.replace(/\s+/g, ' ').trim(), fontSize: run.fontSize }))
    .filter((run) => run.text.length > 0 && !ARXIV_STAMP.test(run.text))
  if (candidates.length === 0) return undefined

  const largest = Math.max(...candidates.map((run) => run.fontSize))
  const title = candidates
    .filter((run) => Math.abs(run.fontSize - largest) < 0.5)
    .map((run) => run.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  // A lone digit or symbol in a big font (page number, drop cap) is not a title.
  if (!/[A-Za-z]{2,}/.test(title)) return undefined
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : title
}

/**
 * Guess a paper title from its PDF when neither the agent nor a metadata
 * API supplied one. Never throws: a guess is optional, so any parse failure
 * yields undefined and the caller falls back further.
 */
export async function guessPdfTitle(pdfBytes: Uint8Array): Promise<string | undefined> {
  try {
    const { items } = await extractTextItems(pdfBytes)
    const firstPage = items[0] ?? []
    return pickTitleFromTextRuns(firstPage.map((item) => ({ str: item.str, fontSize: item.fontSize })))
  } catch {
    return undefined
  }
}
