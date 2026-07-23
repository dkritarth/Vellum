import { useEffect, useState } from 'react'
import { Library } from './Library'
import { Reader } from './Reader'
import { ReaderToolbar } from './ReaderToolbar'
import type { HighlightColor } from './ReaderToolbar'
import { Sidebar } from './Sidebar'
import type { NavItem } from './Sidebar'
import { TabStrip } from './TabStrip'
import type { PaperTab } from './TabStrip'
import { RightPanel } from './RightPanel'
import type { HighlightRecord } from '../../core/highlights/repo'
import styles from './App.module.css'

// Vellum shell — [P1-07] anara-style frame, [P1-08] wires in real data:
//   top: TabStrip (open papers as tabs — one per opened paper, keyed by slug)
//   left: Sidebar (Create / Home / Library / Search + folder tree); selecting
//     'Library' swaps the center pane to the Library grid
//   center: Library grid (click a card -> opens/focuses that paper's tab and
//     switches back to the Reader) or the [P1-09] Reader for the active tab
//   right: RightPanel (Ask | Notes | Details | Annotations)
//
// Tab/view state lives here (the shell's one source of truth) rather than in
// TabStrip/Sidebar/Library themselves, so opening a paper from the Library
// grid and switching tabs both funnel through the same `openPaper`/
// `selectTab` handlers. [P1-14] adds the reader toolbar's highlight stub to
// the center pane so it's visible even before a paper is open.
//
// [P2-02] Highlight tool state (active/color) and the Annotations-tab "jump
// to this highlight's page" seam both live here too, for the same reason:
// ReaderToolbar/Reader/RightPanel are siblings, not parent/child, so
// anything shared between them funnels through App's state rather than a
// prop drilled through an unrelated tree or a global event bus.
export function App(): JSX.Element {
  const [pong, setPong] = useState<string>('…')
  const [tabs, setTabs] = useState<PaperTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [view, setView] = useState<'reader' | 'library'>('reader')
  const [highlightActive, setHighlightActive] = useState(false)
  const [highlightColor, setHighlightColor] = useState<HighlightColor>('yellow')
  const [jumpTarget, setJumpTarget] = useState<{ page: number; highlightId: string; nonce: number } | null>(null)

  useEffect(() => {
    window.vellum?.ping().then(setPong).catch(() => setPong('no-bridge'))
  }, [])

  function openPaper(paper: { slug: string; title: string }): void {
    setTabs((current) => (current.some((tab) => tab.id === paper.slug) ? current : [...current, { id: paper.slug, title: paper.title }]))
    setActiveTabId(paper.slug)
    setView('reader')
  }

  function selectTab(id: string): void {
    setActiveTabId(id)
    setView('reader')
  }

  function handleNavChange(item: NavItem): void {
    setView(item === 'Library' ? 'library' : 'reader')
  }

  // [P2-02] Annotations tab -> Reader jump seam. `nonce` (not just page/id)
  // so clicking the same annotation twice in a row re-triggers the flash —
  // Reader's jump effect keys off this whole object changing, not just its
  // page/highlightId fields.
  function jumpToHighlight(highlight: HighlightRecord): void {
    setJumpTarget({ page: highlight.page, highlightId: highlight.id, nonce: Date.now() })
  }

  return (
    <div className={styles.shell}>
      <TabStrip tabs={tabs} activeTabId={activeTabId} onSelectTab={selectTab} />
      <div className={styles.body}>
        <Sidebar onNavChange={handleNavChange} />
        <main className={styles.centerPane} aria-label="Paper view">
          {view === 'library' ? (
            <Library onOpenPaper={openPaper} />
          ) : (
            <>
              <ReaderToolbar
                active={highlightActive}
                color={highlightColor}
                onToggle={() => setHighlightActive((current) => !current)}
                onColorChange={setHighlightColor}
              />
              <Reader
                slug={activeTabId ?? undefined}
                highlightTool={{ active: highlightActive, color: highlightColor }}
                jumpTarget={jumpTarget}
              />
            </>
          )}
        </main>
        <RightPanel slug={activeTabId ?? undefined} onJumpToHighlight={jumpToHighlight} />
      </div>
      <footer className={styles.statusBar}>
        <span>Vellum</span>
        <span className={styles.statusBarSpacer} />
        <span>bridge: {pong}</span>
      </footer>
    </div>
  )
}
