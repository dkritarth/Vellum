// Top-of-sidebar workspace switcher. anara supports multiple local
// workspaces; Vellum is single-workspace until [P2-10]. Renders the current
// workspace name + a switcher button so the affordance is visible, and shows
// a "coming soon" stub on click instead of doing nothing.
import { useState } from 'react'
import { ComingSoon } from './ComingSoon'
import styles from './WorkspaceSwitcher.module.css'

export function WorkspaceSwitcher(): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.workspaceSwitcher}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-label="Switch workspace"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.name}>My Workspace</span>
        <span className={styles.chevron} aria-hidden="true">
          ⌄
        </span>
      </button>
      {open ? <ComingSoon label="Workspaces" note="Multi-workspace switcher — wiki card [P2-10]" /> : null}
    </div>
  )
}
