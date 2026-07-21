// Top tab strip — one tab per open paper. [P1-07] is layout-only: no papers
// are wired up yet, so `tabs` defaults to empty and the strip shows its
// empty state. Real tab data + open-in-tab wiring lands in [P1-08].
import styles from './TabStrip.module.css'

export interface PaperTab {
  id: string
  title: string
}

interface TabStripProps {
  tabs?: PaperTab[]
  activeTabId?: string | null
}

export function TabStrip({ tabs = [], activeTabId = null }: TabStripProps): JSX.Element {
  return (
    <div className={styles.tabStrip} role="tablist" aria-label="Open papers">
      {tabs.length === 0 ? (
        <div className={styles.empty}>No papers open — open one from Library</div>
      ) : (
        tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={tab.id === activeTabId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {tab.title}
          </div>
        ))
      )}
      <button type="button" className={styles.newTabButton} aria-label="New tab" disabled>
        +
      </button>
    </div>
  )
}
