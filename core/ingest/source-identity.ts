// Source identity identifies an input location; a paper slug identifies durable
// research. New PDF sources use the classifier's location hash. Old basename
// slugs have no provenance, so adopt one only when its stored PDF matches bytes
// exactly. Bind that source before writes so subsequent updates keep the slug.
// No bulk rename: old paths and research foreign keys stay in place.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { getPaper } from '../library/repo.js'
import type { ClassifiedInput } from './classify.js'

export function recordPaperSource(db: Database, input: ClassifiedInput, slug: string): void {
  if (input.legacySlug) {
    db.prepare('INSERT INTO paper_sources (source_id, paper_slug) VALUES (?, ?) ON CONFLICT(source_id) DO NOTHING')
      .run(input.slug, slug)
    const binding = db.prepare('SELECT paper_slug FROM paper_sources WHERE source_id = ?')
      .get(input.slug) as { paper_slug: string }
    if (binding.paper_slug !== slug) throw new Error('ingest: source already belongs to another paper')
  }
}

/** Resolve paper files before the orchestrator can overwrite them. Legacy
 * adoption and source binding run in one synchronous SQLite transaction, so
 * concurrent distinct inputs cannot both adopt the same research record.
 * Tests exercise this through ingest(), not a new public application seam. */
export function resolvePaperSource(
  input: ClassifiedInput,
  pdfBytes: Uint8Array,
  options: { db: Database; dataDir: string },
): { slug: string; pdfPath: string; mdPath: string } {
  const directory = join(options.dataDir, 'papers', input.slug)
  const paths = {
    slug: input.slug,
    pdfPath: join(directory, 'paper.pdf'),
    mdPath: join(directory, 'paper.md'),
  }
  const legacySlug = input.legacySlug
  if (!legacySlug) return paths

  return options.db.transaction(() => {
    const binding = options.db.prepare('SELECT paper_slug FROM paper_sources WHERE source_id = ?')
      .get(input.slug) as { paper_slug: string } | undefined
    const assigned = binding && getPaper(options.db, binding.paper_slug)
    if (assigned?.pdfPath && assigned.mdPath) {
      return { slug: assigned.slug, pdfPath: assigned.pdfPath, mdPath: assigned.mdPath }
    }

    // A hash slug already in use wins over a later legacy content match.
    // Otherwise changed source bytes could switch slugs and strand research.
    if (getPaper(options.db, input.slug)) return paths
    const legacy = getPaper(options.db, legacySlug)
    if (!legacy?.pdfPath || !legacy.mdPath) return paths
    const claimed = options.db.prepare('SELECT source_id FROM paper_sources WHERE paper_slug = ?')
      .get(legacy.slug)
    if (claimed) return paths
    let legacyBytes: Buffer
    try {
      legacyBytes = readFileSync(legacy.pdfPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return paths
      throw error
    }
    if (!legacyBytes.equals(Buffer.from(pdfBytes))) return paths
    recordPaperSource(options.db, input, legacy.slug)
    return { slug: legacy.slug, pdfPath: legacy.pdfPath, mdPath: legacy.mdPath }
  }).immediate()
}
