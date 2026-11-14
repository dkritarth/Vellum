// AnnotationsPanel — [P2-02] Annotations tab. Lists this paper's highlights
// (color swatch, quote, page), lets the user jump the Reader to one and
// delete it. Talks only to `window.vellum` (preload bridge) — never imports
// Node/core directly, per AGENTS.md. Mirrors NotesPanel's slug-driven
// load/reset shape.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HighlightRecord } from '../../core/highlights/repo'
import styles from './AnnotationsPanel.module.css'

interface AnnotationsPanelProps {
  /** Slug of the currently open paper, if any. Undefined = no paper open. */
  slug?: string
  /** Monotonic invalidation count for `slug`, advanced only after a persisted change. */
  highlightsRevision?: number
  /** Reports only persisted deletions, including late outgoing-paper completions. */
  onHighlightDeleted?: (paperSlug: string) => void
  /** Drives the Reader to a highlight's page (and flashes it) — wired by
   * App, since Reader and this panel are siblings under it. */
  onJump?: (highlight: HighlightRecord) => void
}

export function AnnotationsPanel({ slug, onJump, onHighlightDeleted, highlightsRevision = 0 }: AnnotationsPanelProps): JSX.Element {
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [deleteErrors, setDeleteErrors] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  // A paper revisit is a new view, even when its slug matches an old operation.
  const visit = useRef(0)
  const pendingDeletes = useRef(new Set<string>())
  // Slug the panel currently shows; a list response for any other paper is
  // stale (user switched tabs mid-request) and must not overwrite the view.
  const currentSlug = useRef(slug)
  currentSlug.current = slug

  const requestVersion = useRef(0)

  const load = useCallback((paperSlug: string) => {
    if (currentSlug.current !== paperSlug) return
    const version = ++requestVersion.current
    const isCurrent = () => currentSlug.current === paperSlug && requestVersion.current === version
    setLoading(true)
    window.vellum
      .highlightsList(paperSlug)
      .then((records) => {
        if (isCurrent()) {
          setHighlights(records)
          setLoadError(false)
        }
      })
      .catch(() => {
        if (isCurrent()) setLoadError(true)
      })
      .finally(() => {
        if (isCurrent()) setLoading(false)
      })
  }, [])

  useEffect(() => {
    setHighlights([])
    setLoadError(false)
    setDeleteErrors(new Set())
    setDeleting(new Set())
    pendingDeletes.current = new Set()
    return () => { visit.current += 1 }
  }, [slug])

  useEffect(() => {
    if (!slug) {
      setLoading(false)
      return
    }
    load(slug)
    return () => { requestVersion.current += 1 }
  }, [slug, highlightsRevision, load])

  const deleteHighlight = useCallback(
    (id: string) => {
      if (!slug || currentSlug.current !== slug || pendingDeletes.current.has(id)) return
      const originVisit = visit.current
      const pending = pendingDeletes.current
      const isCurrent = () => currentSlug.current === slug && visit.current === originVisit
      pending.add(id)
      setDeleting(new Set(pending))
      window.vellum
        .highlightsDelete(id)
        .then(() => {
          if (isCurrent()) {
            // A persisted delete stays removed even if its following read fails.
            setHighlights((rows) => rows.filter((row) => row.id !== id))
            setDeleteErrors((errors) => new Set([...errors].filter((errorId) => errorId !== id)))
          }
          onHighlightDeleted?.(slug)
          if (isCurrent()) load(slug)
        })
        .catch(() => {
          if (isCurrent()) setDeleteErrors((errors) => new Set(errors).add(id))
        })
        .finally(() => {
          pending.delete(id)
          if (isCurrent()) setDeleting(new Set(pending))
        })
    },
    [slug, load, onHighlightDeleted],
  )

  if (!slug) return <p className={styles.placeholder}>Open a paper to view its highlights.</p>

  return (
    <>
      {loadError && (
        <div role="alert" className={styles.error}>
          Could not load highlights. Saved highlights may still be available.
          <button type="button" disabled={loading} onClick={() => load(slug)}>Retry loading highlights</button>
        </div>
      )}
      {loading && <p role="status" className={styles.placeholder}>Loading highlights…</p>}
      {!loading && !loadError && highlights.length === 0 && (
        <p className={styles.placeholder}>No highlights yet — turn on Highlight mode and select text to add one.</p>
      )}
      <ul className={styles.annotationsPanel}>
        {highlights.map((highlight) => (
          <li key={highlight.id} className={styles.row}>
            <button type="button" className={styles.rowMain} onClick={() => onJump?.(highlight)}>
              <span className={styles.swatch} style={{ background: highlight.color }} aria-hidden="true" />
              <span className={styles.quote}>{highlight.quote}</span>
              <span className={styles.page}>Page {highlight.page}</span>
            </button>
            <button
              type="button"
              className={styles.deleteButton}
              disabled={deleting.has(highlight.id)}
              aria-label={`Delete highlight: ${highlight.quote}`}
              onClick={() => deleteHighlight(highlight.id)}
            >
              ×
            </button>
            {deleteErrors.has(highlight.id) && (
              <div role="alert" className={styles.error}>
                Could not delete highlight. Your saved highlight is still available.
                <button
                  type="button"
                  disabled={deleting.has(highlight.id)}
                  aria-label={`Retry deleting highlight: ${highlight.quote}`}
                  onClick={() => deleteHighlight(highlight.id)}
                >Retry delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
