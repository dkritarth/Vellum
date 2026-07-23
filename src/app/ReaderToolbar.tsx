// Reader toolbar — sits above the paper pane. [P2-02]: the highlight button
// is a real tool toggle (not a "coming soon" stub anymore) — activating it
// switches the Reader's text layer into highlight-capture mode (see
// Reader.tsx's `handleTextLayerMouseUp`), and a color swatch row lets the
// user pick which of four highlight colors new highlights use. Tool
// active/color state is lifted to App (the shell's one source of truth,
// same pattern as tabs/view) since ReaderToolbar and Reader are siblings
// under App, not parent/child.
import styles from './ReaderToolbar.module.css'

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

interface ReaderToolbarProps {
  /** Whether the highlight tool is currently active (text-layer selections
   * create highlights instead of just selecting text). */
  active: boolean
  /** Color new highlights are created with while the tool is active. */
  color: HighlightColor
  onToggle: () => void
  onColorChange: (color: HighlightColor) => void
}

export function ReaderToolbar({ active, color, onToggle, onColorChange }: ReaderToolbarProps): JSX.Element {
  return (
    <div className={styles.readerToolbar}>
      <div className={styles.toolbarRow}>
        <button type="button" className={styles.highlightButton} aria-pressed={active} onClick={onToggle}>
          <span aria-hidden="true">✎</span> Highlight
        </button>
        {active
          ? HIGHLIGHT_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`${swatch} highlight color`}
                aria-pressed={swatch === color}
                className={
                  swatch === color ? `${styles.colorSwatch} ${styles.colorSwatchActive}` : styles.colorSwatch
                }
                style={{ background: swatch }}
                onClick={() => onColorChange(swatch)}
              />
            ))
          : null}
      </div>
    </div>
  )
}
