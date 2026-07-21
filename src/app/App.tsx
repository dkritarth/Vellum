import { useEffect, useState } from 'react'
import { Reader } from './Reader'
import { ReaderToolbar } from './ReaderToolbar'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { RightPanel } from './RightPanel'
import styles from './App.module.css'

// Vellum shell — [P1-07] anara-style frame:
//   top: TabStrip (open papers as tabs)
//   left: Sidebar (Create / Home / Library / Search + folder tree)
//   center: paper pane ([P1-09] Reader; renders its own empty state until a
//     paper is open — no open-in-tab wiring exists yet, that's [P1-08])
//   right: RightPanel (Ask | Notes | Details | Annotations)
//
// Layout-only: no papers, no IPC wiring beyond the boot-time ping check
// carried over from the scaffold. Renders fine with zero papers, the only
// state that exists right now. [P1-14] adds the reader toolbar's highlight
// stub to the center pane so it's visible even before a paper is open.
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
          <ReaderToolbar />
          <Reader />
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
