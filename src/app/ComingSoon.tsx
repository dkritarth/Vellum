// Shared "coming soon" stub for Phase-2+ affordances. Every deferred button
// in the shell renders one of these instead of being dead/invisible — see
// wiki card [P1-12] (this card only needs it for the right-panel tabs).
import styles from './ComingSoon.module.css'

interface ComingSoonProps {
  label: string
  note?: string
}

export function ComingSoon({ label, note }: ComingSoonProps): JSX.Element {
  return (
    <div className={styles.comingSoon}>
      <p className={styles.title}>{label} — coming soon</p>
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  )
}
