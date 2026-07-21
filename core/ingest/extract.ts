// Extract section boundaries + metadata from paper.md via a single ACP agent
// turn. No heuristic/regex fallback (that was the old CLI, banned by
// [P1-05]) — the agent reads paper.md itself (passed as an ACP contextFile,
// its own file tools, no RAG) and reports back structured JSON.
//
// Degrade, never throw: real papers convert unevenly (missing sections,
// stray OCR noise, agents that wrap JSON in prose or a fence, or that just
// fail to find a References section). Every failure mode here — spawn
// failure, stream error, unparseable text, wrong-typed fields — collapses to
// a `degraded: true` result carrying whatever could be salvaged, never a
// thrown error. Callers (the [P1-06] store writer) can persist a degraded
// result as-is.
//
// MANUAL CHECK (real paper, real agent — not exercised by the mocked tests
// below): running a live ACP agent turn from inside a Claude Code terminal
// hits a nesting block (CLAUDECODE env var), so run this from a plain
// terminal instead:
//
//   env -u CLAUDECODE npx tsx -e "
//     import('./core/ingest/extract.js').then(async ({ extractPaper }) => {
//       const r = await extractPaper('/absolute/path/to/data/papers/<slug>/paper.md')
//       console.log(JSON.stringify(r, null, 2))
//     })
//   "
//
// Eyeball: `degraded` is false, `sections` roughly matches the paper's real
// headings (Abstract/Introduction/.../References) in order, and `metadata`
// has a sane title/authors/year. Requires `claude-code-acp` on PATH and a
// signed-in Claude plan. UNVERIFIED-pending-manual — not run in this sandbox
// (same CLAUDECODE nesting block applies here).

// The AcpClient/AcpSession/AcpUpdate *contract* this module programs against
// comes only from client.ts (see ExtractOptions.client below — that's the
// injectable seam tests use). StdioAcpClient is the one concrete
// implementation of that contract and is only ever used as this module's
// default; core/acp/ itself is untouched.
import type { AcpBackend, AcpClient, AcpUpdate } from '../acp/client.js'
import { StdioAcpClient } from '../acp/stdio-client.js'

export interface ExtractedSection {
  title: string
  /** 0-based char offsets into paper.md, if the agent located them precisely. */
  startOffset?: number
  endOffset?: number
}

export interface ExtractedMetadata {
  title?: string
  authors?: string[]
  year?: number
  venue?: string
  abstract?: string
}

export interface ExtractResult {
  sections: ExtractedSection[]
  metadata: ExtractedMetadata
  /** True whenever the agent's output was missing, unparseable, or had
   * fields dropped for the wrong shape — sections/metadata may be partial or
   * empty. Not an error: [P1-05] explicitly requires degrading, not throwing. */
  degraded: boolean
}

export interface ExtractOptions {
  /** Injectable ACP client — defaults to the real StdioAcpClient. Tests pass
   * a fake that yields canned AcpUpdates instead of spawning an adapter. */
  client?: AcpClient
  backend?: AcpBackend
}

/** Fresh literal per call (not a shared constant) — callers may reasonably
 * treat `sections`/`metadata` as owned, mutable arrays/objects once
 * returned, and a shared instance would let one caller's mutation leak into
 * every other degraded result. */
function emptyResult(): ExtractResult {
  return { sections: [], metadata: {}, degraded: true }
}

function buildPrompt(mdPath: string): string {
  return [
    `Read the paper markdown file at ${mdPath} using your file tools.`,
    'Identify its section structure and key metadata.',
    '',
    'Respond with ONLY a single JSON object — no prose, no markdown code fence — in exactly this shape:',
    '{',
    '  "sections": [ { "title": string, "startOffset": number, "endOffset": number } ],',
    '  "metadata": { "title": string, "authors": string[], "year": number, "venue": string, "abstract": string }',
    '}',
    '',
    'Use the paper\'s own heading names for section titles, in reading order. Offsets are 0-based',
    'character offsets into the file content you read. Omit any metadata field you cannot find.',
    'If the paper has no clear section structure, return an empty "sections" array rather than guessing.',
  ].join('\n')
}

/**
 * Extract section boundaries + metadata from paper.md via one ACP agent
 * turn. Never throws — every failure path (spawn, stream, parse, shape)
 * resolves to a result with `degraded: true`.
 */
export async function extractPaper(mdPath: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const client = options.client ?? new StdioAcpClient()
  const backend = options.backend ?? 'claude'

  const session = await client.newSession(backend).catch(() => undefined)
  if (!session) return emptyResult()

  try {
    let raw = ''

    try {
      for await (const update of session.prompt({ text: buildPrompt(mdPath), contextFiles: [mdPath] })) {
        if (update.kind === 'text') {
          raw += textFromUpdate(update)
        } else if (update.kind === 'error' || update.kind === 'done') {
          break
        }
      }
    } catch {
      // Stream itself threw (adapter died mid-turn, transport error, ...).
      // Fall through to parsing whatever text was collected before the throw.
    }

    return parseAgentOutput(raw)
  } finally {
    await session.dispose().catch(() => undefined)
  }
}

/** Pulls plain text out of an AcpUpdate whose kind is 'text'. `data` is
 * `unknown` in the AcpClient contract (it's a raw ACP ContentBlock) — this is
 * a defensive type guard, not a real ContentBlock parser. */
function textFromUpdate(update: AcpUpdate): string {
  const data = update.data
  if (typeof data !== 'object' || data === null) return ''
  const block = data as Record<string, unknown>
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  return ''
}

/** Finds the JSON object in raw agent text: strips a ```json fence if
 * present, otherwise takes the substring between the first `{` and the
 * matching last `}` (agents commonly wrap JSON in a sentence or two). */
function extractJsonSlice(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return undefined
  return raw.slice(start, end + 1)
}

function parseAgentOutput(raw: string): ExtractResult {
  const slice = extractJsonSlice(raw)
  if (!slice) return emptyResult()

  let parsed: unknown
  try {
    parsed = JSON.parse(slice)
  } catch {
    return emptyResult()
  }

  if (typeof parsed !== 'object' || parsed === null) return emptyResult()
  const obj = parsed as Record<string, unknown>

  const sectionsRaw = obj.sections
  const hasSectionsField = Array.isArray(sectionsRaw)
  const sections = hasSectionsField ? normalizeSections(sectionsRaw) : []

  const metadataRaw = obj.metadata
  const hasMetadataField = typeof metadataRaw === 'object' && metadataRaw !== null
  const metadata = hasMetadataField ? normalizeMetadata(metadataRaw as Record<string, unknown>) : {}

  const lostSections = hasSectionsField && sections.length !== (sectionsRaw as unknown[]).length
  const lostMetadataFields =
    hasMetadataField && Object.keys(metadata).length !== Object.keys(metadataRaw as Record<string, unknown>).length

  const degraded = !hasSectionsField || !hasMetadataField || lostSections || lostMetadataFields

  return { sections, metadata, degraded }
}

function normalizeSections(raw: unknown[]): ExtractedSection[] {
  const out: ExtractedSection[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    if (typeof rec.title !== 'string' || rec.title.length === 0) continue
    const section: ExtractedSection = { title: rec.title }
    if (typeof rec.startOffset === 'number') section.startOffset = rec.startOffset
    if (typeof rec.endOffset === 'number') section.endOffset = rec.endOffset
    out.push(section)
  }
  return out
}

function normalizeMetadata(raw: Record<string, unknown>): ExtractedMetadata {
  const metadata: ExtractedMetadata = {}
  if (typeof raw.title === 'string') metadata.title = raw.title
  if (Array.isArray(raw.authors) && raw.authors.every((a) => typeof a === 'string')) {
    metadata.authors = raw.authors as string[]
  }
  if (typeof raw.year === 'number') metadata.year = raw.year
  if (typeof raw.venue === 'string') metadata.venue = raw.venue
  if (typeof raw.abstract === 'string') metadata.abstract = raw.abstract
  return metadata
}
