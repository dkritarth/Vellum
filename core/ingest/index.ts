// Ingestion pipeline (pure Node/TS — no Python).
//
// Flow (built per Phase-1 wiki cards):
//   1. classify input: arXiv id/url | DOI | PDF url | local PDF path
//   2. fetch: download PDF + metadata (arXiv/Crossref APIs via fetch)
//   3. convert: PDF -> markdown (Node PDF lib, e.g. unpdf/pdf.js) -> paper.md
//   4. extract: sections + clean metadata via an ACP agent turn (not regex)
//   5. store: write files to data/papers/<slug>/, insert row via core/store
//
// Section extraction is an agent prompt now (Q6/Q7 decisions), so there is no
// heuristic-regex fallback to port from the old CLI.

export type InputKind = 'arxiv' | 'doi' | 'pdf_url' | 'local_pdf'

export interface IngestResult {
  slug: string
  title: string
  mdPath: string
  pdfPath: string
}

export function classifyInput(_raw: string): InputKind {
  // TODO(ingest-task-1): port classify_input() logic to TS (arxiv id/url,
  // doi.org, direct .pdf url, local filesystem path).
  throw new Error('not implemented')
}

export async function ingest(_raw: string): Promise<IngestResult> {
  // TODO(ingest-task-2..n): fetch -> convert -> agent-extract -> store.
  throw new Error('not implemented')
}
