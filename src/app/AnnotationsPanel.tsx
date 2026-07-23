// AnnotationsPanel — [P2-02] Annotations tab. Lists this paper's highlights
// (color swatch, quote, page), lets the user jump the Reader to one and
// delete it. Talks only to `window.vellum` (preload bridge) — never imports
// Node/core directly, per AGENTS.md. Mirrors NotesPanel's slug-driven
// load/reset shape.
import { useCallback, useEffect, useState } from 'react'
import type { HighlightRecord } from '../../core/highlights/repo'
import styles from './AnnotationsPanel.module.css'

interface AnnotationsPanelProps {
  /** Slug of the currently open paper, if any. Undefined = no paper open. */
  slug?: string
  /** Drives the Reader to a highlight's page (and flashes it) — wired by
   * App, since Reader and this panel are siblings under it. */
  onJump?: (highlight: HighlightRecord) => void
}

export function AnnotationsPanel({ slug, onJump }: AnnotationsPanelProps): JSX.Element {
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback((paperSlug: string) => {
    setLoading(true)
    window.vellum
      .highlightsList(paperSlug)
      .then((records) => setHighlights(records))
      .catch(() => setHighlights([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!slug) {
      setHighlights([])
      return
    }
    load(slug)
  }, [slug, load])

  const deleteHighlight = useCallback(
    (id: string) => {
      if (!slug) return
      window.vellum
        .highlightsDelete(id)
        .then(() => load(slug))
        .catch(() => undefined)
    },
    [slug, load],
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
