import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { RightPanel } from './RightPanel'
import styles from './App.module.css'

// Vellum shell — [P1-07] anara-style frame:
//   top: TabStrip (open papers as tabs)
//   left: Sidebar (Create / Home / Library / Search + folder tree)
//   center: paper pane (reader lands in [P1-09]; empty state until then)
//   right: RightPanel (Ask | Notes | Details | Annotations)
//
// Layout-only: no papers, no IPC wiring beyond the boot-time ping check
// carried over from the scaffold. Renders fine with zero papers, the only
// state that exists right now.
export function App(): JSX.Element {
  const [pong, setPong] = useState<string>('…')

  useEffect(() => {
    window.vellum?.ping().then(setPong).catch(() => setPong('no-bridge'))
  }, [])

  return (
    <div className={styles.shell}>
      <TabStrip />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.centerPane} aria-label="Paper view">
          <div className={styles.centerEmpty}>
            <p>No paper open</p>
            <p className={styles.centerEmptyHint}>Open a paper from Library to start reading.</p>
          </div>
        </main>
        <RightPanel />
      </div>
      <footer className={styles.statusBar}>
        <span>Vellum</span>
        <span className={styles.statusBarSpacer} />
        <span>bridge: {pong}</span>
      </footer>
    </div>
  )
}
