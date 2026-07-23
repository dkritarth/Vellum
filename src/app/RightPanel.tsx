// Right panel — Ask / Notes / Details / Annotations, switchable via client
// state.
//   - Ask: [P1-10] grounded chat (AskPanel) once a paper is open (bound to
//     its slug); the [P1-07] empty-state placeholder + stubbed AskInput bar
//     still cover the no-paper-open case.
//   - Notes: [P2-01] per-paper markdown note (NotesPanel), bound to slug.
//   - Details renders an empty-state placeholder (real logic: [P1-12]).
//   - Annotations: [P2-02] this paper's highlights (AnnotationsPanel), bound
//     to slug; clicking one jumps the Reader to its page via
//     `onJumpToHighlight` (threaded down from App — Reader and this panel
//     are siblings under it, not parent/child).
import { useState } from 'react'
import { AnnotationsPanel } from './AnnotationsPanel'
import { AskInput } from './AskInput'
import { AskPanel } from './AskPanel'
import { DetailsPanel } from './DetailsPanel'
import { NotesPanel } from './NotesPanel'
import type { HighlightRecord } from '../../core/highlights/repo'
import styles from './RightPanel.module.css'

const RIGHT_PANEL_TABS = ['Ask', 'Notes', 'Details', 'Annotations'] as const
export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number]

interface RightPanelProps {
  defaultTab?: RightPanelTab
  /** Slug of the currently open paper, if any — scopes the Ask/Notes/
   * Annotations tabs. Undefined = no paper open, each tab shows its own
   * empty state instead. */
  slug?: string
  /** [P2-02] Drives the Reader to a clicked annotation's page. Undefined =
   * jump seam not wired (e.g. tests rendering RightPanel standalone). */
  onJumpToHighlight?: (highlight: HighlightRecord) => void
}

export function RightPanel({ defaultTab = 'Ask', slug, onJumpToHighlight }: RightPanelProps): JSX.Element {
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
        {renderTabContent(activeTab, slug, onJumpToHighlight)}
      </div>
    </aside>
  )
}

function renderTabContent(
  tab: RightPanelTab,
  slug: string | undefined,
  onJumpToHighlight: ((highlight: HighlightRecord) => void) | undefined,
): JSX.Element {
  switch (tab) {
    case 'Ask':
      if (slug) return <AskPanel slug={slug} />
      return (
        <div className={styles.askTab}>
          <p className={styles.placeholder}>Open a paper to start asking questions.</p>
          <AskInput />
        </div>
      )
    case 'Notes':
      return <NotesPanel slug={slug} />
    case 'Details':
      return <DetailsPanel slug={slug} />
    case 'Annotations':
      return <AnnotationsPanel slug={slug} onJump={onJumpToHighlight} />
  }
}
