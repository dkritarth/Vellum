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
        if (isCurrent()) setHighlights(records)
      })
      .catch(() => {
        if (isCurrent()) setHighlights([])
      })
      .finally(() => {
        if (isCurrent()) setLoading(false)
      })
  }, [])

  useEffect(() => {
    setHighlights([])
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
      if (!slug) return
      window.vellum
        .highlightsDelete(id)
        .then(() => {
          onHighlightDeleted?.(slug)
          load(slug)
        })
        .catch(() => undefined)
    },
    [slug, load, onHighlightDeleted],
  )

  if (!slug) return <p className={styles.placeholder}>Open a paper to view its highlights.</p>

  if (!loading && highlights.length === 0) {
    return <p className={styles.placeholder}>No highlights yet — turn on Highlight mode and select text to add one.</p>
  }

  return (
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
            aria-label={`Delete highlight: ${highlight.quote}`}
            onClick={() => deleteHighlight(highlight.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
