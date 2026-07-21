// Minimal stub for the Ask chat input bar. anara's input supports a `/`
// skill picker and `@` context mentions — both Phase-2 ([P2-11]). No input
// component existed before this card; this renders the bar (disabled text
// field + trigger buttons) so the affordance is visible, wiring nothing real.
import { useState } from 'react'
import { ComingSoon } from './ComingSoon'
import styles from './AskInput.module.css'

type StubTrigger = 'skills' | 'context' | null

export function AskInput(): JSX.Element {
  const [open, setOpen] = useState<StubTrigger>(null)

  const toggle = (trigger: StubTrigger) => () => {
    setOpen((current) => (current === trigger ? null : trigger))
  }

  return (
    <div className={styles.askInput}>
      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.triggerButton}
          aria-label="Skills"
          aria-pressed={open === 'skills'}
          onClick={toggle('skills')}
        >
          /
        </button>
        <button
          type="button"
          className={styles.triggerButton}
          aria-label="Context"
          aria-pressed={open === 'context'}
          onClick={toggle('context')}
        >
          @
        </button>
        <input
          type="text"
          className={styles.textInput}
          placeholder="Ask a question about this paper…"
          aria-label="Ask a question"
          disabled
        />
      </div>
      {open === 'skills' ? (
        <ComingSoon label="Skills" note="`/` skill picker — wiki card [P2-11]" />
      ) : null}
      {open === 'context' ? (
        <ComingSoon label="Context" note="`@` context mentions — wiki card [P2-11]" />
      ) : null}
    </div>
  )
}
