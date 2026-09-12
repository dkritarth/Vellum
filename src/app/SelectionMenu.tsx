import { useEffect, useRef } from 'react'
import type { HighlightColor } from './ReaderToolbar'
import styles from './SelectionMenu.module.css'

const SWATCH_HEX: Record<HighlightColor, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
}

const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink']

export interface SelectionMenuProps {
  x: number
  y: number
  quote: string
  page: number
  onAddToChat: () => void
  onExplain: () => void
  onHighlight: (color: HighlightColor) => void
  onClose: () => void
}

export function SelectionMenu({
  x,
  y,
  quote: _quote,
  page: _page,
  onAddToChat,
  onExplain,
  onHighlight,
  onClose,
}: SelectionMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: `${x}px`, top: `${y}px` }}
      role="toolbar"
      aria-label="Selection actions"
      onMouseDown={(event) => {
        // Prevent selection from collapsing when clicking toolbar buttons
        event.stopPropagation()
      }}
    >
      <button
        type="button"
        className={styles.actionButton}
        onClick={onAddToChat}
        title="Insert quoted selection into Ask composer"
      >
        Add to chat
      </button>
      <button
        type="button"
        className={styles.actionButton}
        onClick={onExplain}
        title="Ask agent to explain this passage"
      >
        Explain
      </button>
      <div className={styles.divider} />
      <div className={styles.swatches}>
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.swatchButton}
            style={{ backgroundColor: SWATCH_HEX[color] }}
            aria-label={`Highlight ${color}`}
            title={`Highlight ${color}`}
            onClick={() => onHighlight(color)}
          />
        ))}
      </div>
    </div>
  )
}
