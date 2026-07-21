// Right panel — Ask / Notes / Details / Annotations, switchable via client
// state. [P1-07] is layout-only:
//   - Ask, Details render an empty-state placeholder (real logic: [P1-10]
//     grounded chat, [P1-13]/metadata for Details).
//   - Notes, Annotations are Phase-2 and render a visible "coming soon" stub
//     linking their wiki card — never a dead/invisible button.
import { useState } from 'react'
import { ComingSoon } from './ComingSoon'
import styles from './RightPanel.module.css'

const RIGHT_PANEL_TABS = ['Ask', 'Notes', 'Details', 'Annotations'] as const
export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number]

const DEFERRED_TABS: Partial<Record<RightPanelTab, { note: string }>> = {
  Notes: { note: 'Per-paper notes — wiki card [P2-01]' },
  Annotations: { note: 'Highlights + annotations — wiki card [P2-02]' },
}

interface RightPanelProps {
  defaultTab?: RightPanelTab
}

export function RightPanel({ defaultTab = 'Ask' }: RightPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<RightPanelTab>(defaultTab)

  return (
    <aside className={styles.rightPanel} aria-label="Paper panel">
      <div className={styles.tabList} role="tablist" aria-label="Right panel views">
        {RIGHT_PANEL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === activeTab}
            className={tab === activeTab ? `${styles.tabButton} ${styles.tabButtonActive}` : styles.tabButton}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className={styles.tabPanel} role="tabpanel">
        {renderTabContent(activeTab)}
      </div>
    </aside>
  )
}

function renderTabContent(tab: RightPanelTab): JSX.Element {
  const deferred = DEFERRED_TABS[tab]
  if (deferred) {
    return <ComingSoon label={tab} note={deferred.note} />
  }

  // Only Ask/Details reach here — Notes/Annotations are handled above via
  // DEFERRED_TABS.
  switch (tab as 'Ask' | 'Details') {
    case 'Ask':
      return <p className={styles.placeholder}>Open a paper to start asking questions.</p>
    case 'Details':
      return <p className={styles.placeholder}>No paper open — metadata will show here.</p>
  }
}
