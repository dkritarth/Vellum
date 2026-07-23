// CitationTooltip — small floating box showing a reference's citation text,
// shown on hover of an inline `[n]` marker in the Reader's text layer
// [P2-03]. Purely presentational: Reader owns all hover-state logic (which
// marker is hovered, where it sits) and just passes the resolved text and
// position down.
import styles from './CitationTooltip.module.css'

interface CitationTooltipProps {
  /** The reference entry's citation text (e.g. "Smith, J. Title A."). */
  text: string
  /** Position, relative to the Reader's text-layer container — same
   * coordinate space `OverlayRect`s (highlights) use. */
  left: number
  top: number
}

export function CitationTooltip({ text, left, top }: CitationTooltipProps): JSX.Element {
  return (
    <div className={styles.tooltip} role="tooltip" style={{ left, top }}>
      {text}
    </div>
  )
}
