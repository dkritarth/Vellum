// Internal synchronous publication scope. The caller owns the SQLite transaction
// and must return only after COMMIT. No await or other ingest can interleave file
// replacement/recovery in this process. This is not crash/power-loss atomicity.
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import type { IngestPaths } from './index.js'

interface Replacement {
  target: string
  directory: string
  candidate: string
  original: string
  backedUp: boolean
  published: boolean
}

export function withPaperPublication<T>(
  candidate: IngestPaths,
  commit: (publish: (paths: IngestPaths) => void) => T,
): T {
  const replacements: Replacement[] = []
  let retainBackups = false
  try {
    return commit((paths) => {
      for (const key of ['pdfPath', 'mdPath'] as const) {
        const target = paths[key]
        fs.mkdirSync(dirname(target), { recursive: true })
        // Siblings ensure rename stays on the target filesystem, even for
        // legacy paths outside dataDir or PDF/Markdown on separate volumes.
        const directory = fs.mkdtempSync(join(dirname(target), '.vellum-ingest-'))
        const replacement = {
          target, directory, candidate: join(directory, 'candidate'),
          original: join(directory, 'original'), backedUp: false, published: false,
        }
        replacements.push(replacement)
        fs.copyFileSync(candidate[key], replacement.candidate)
      }
      for (const replacement of replacements) {
        try {
          const existing = fs.lstatSync(replacement.target)
          if (!existing.isFile() && !existing.isSymbolicLink()) {
            throw new Error(`ingest: refusing to replace a non-file at ${replacement.target}`)
          }
          fs.renameSync(replacement.target, replacement.original)
          replacement.backedUp = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        fs.renameSync(replacement.candidate, replacement.target)
        replacement.published = true
      }
    })
  } catch (error) {
    const recoveryErrors: unknown[] = []
    for (const replacement of [...replacements].reverse()) {
      try {
        if (replacement.backedUp) {
          fs.renameSync(replacement.original, replacement.target)
        } else if (replacement.published) {
          fs.rmSync(replacement.target)
        }
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError)
      }
    }
    if (recoveryErrors.length) {
      retainBackups = true
      const locations = replacements.map(r => `${r.original} -> ${r.target}`).join('; ')
      throw new AggregateError([error, ...recoveryErrors],
        `ingest: publication failed and recovery is incomplete. Retained recovery locations: ${locations}`, { cause: error })
    }
    throw error
  } finally {
    if (!retainBackups) {
      for (const replacement of replacements) {
        try {
          fs.rmSync(replacement.directory, { recursive: true, force: true })
        } catch (error) {
          // Cleanup after COMMIT must not report the import as failed.
          console.warn(`ingest: temporary files retained at ${replacement.directory}`, error)
        }
      }
    }
  }
}
