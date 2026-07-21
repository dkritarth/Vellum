// Right panel — Ask / Notes / Details / Annotations, switchable via client
// state.
//   - Ask: [P1-10] grounded chat (AskPanel) once a paper is open (bound to
//     its slug); the [P1-07] empty-state placeholder + stubbed AskInput bar
//     still cover the no-paper-open case.
//   - Details renders an empty-state placeholder (real logic: [P1-12]).
//   - Notes, Annotations are Phase-2 and render a visible "coming soon" stub
//     linking their wiki card — never a dead/invisible button.
import { useState } from 'react'
import { AskInput } from './AskInput'
import { AskPanel } from './AskPanel'
import { ComingSoon } from './ComingSoon'
import { DetailsPanel } from './DetailsPanel'
import styles from './RightPanel.module.css'

const RIGHT_PANEL_TABS = ['Ask', 'Notes', 'Details', 'Annotations'] as const
export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number]

const DEFERRED_TABS: Partial<Record<RightPanelTab, { note: string }>> = {
  Notes: { note: 'Per-paper notes — wiki card [P2-01]' },
  Annotations: { note: 'Highlights + annotations — wiki card [P2-02]' },
}

interface RightPanelProps {
  defaultTab?: RightPanelTab
  /** Slug of the currently open paper, if any — scopes the Ask tab's chat.
   * Undefined = no paper open, Ask shows the [P1-07] empty-state instead. */
  slug?: string
}

export function RightPanel({ defaultTab = 'Ask', slug }: RightPanelProps): JSX.Element {
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
        {renderTabContent(activeTab, slug)}
      </div>
    </aside>
  )
}

function renderTabContent(tab: RightPanelTab, slug: string | undefined): JSX.Element {
  const deferred = DEFERRED_TABS[tab]
  if (deferred) {
    return <ComingSoon label={tab} note={deferred.note} />
  }

  // Only Ask/Details reach here — Notes/Annotations are handled above via
  // DEFERRED_TABS.
  switch (tab as 'Ask' | 'Details') {
    case 'Ask':
      if (slug) return <AskPanel slug={slug} />
      return (
        <div className={styles.askTab}>
          <p className={styles.placeholder}>Open a paper to start asking questions.</p>
          <AskInput />
        </div>
      )
    case 'Details':
      return <DetailsPanel slug={slug} />
  }
}
