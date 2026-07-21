// Reader toolbar — sits above the paper pane. The reader itself lands in
// [P1-09]; this card only needs the highlight-tool affordance visible before
// then, per anara's chrome. Click shows a "coming soon" stub instead of a
// dead button (real highlighting + Annotations tab: [P2-02]).
import { useState } from 'react'
import { ComingSoon } from './ComingSoon'
import styles from './ReaderToolbar.module.css'

export function ReaderToolbar(): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.readerToolbar}>
      <div className={styles.toolbarRow}>
        <button
          type="button"
          className={styles.highlightButton}
          aria-pressed={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">✎</span> Highlight
        </button>
      </div>
      {open ? <ComingSoon label="Highlight" note="Highlight tool + Annotations — wiki card [P2-02]" /> : null}
    </div>
  )
}
