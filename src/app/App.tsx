import { TrashView } from './TrashView.js'
import { UsageView } from './UsageView.js'
import type { ChatSessionSummary } from '../../core/chat/repo'
import { useEffect, useState } from 'react'
import { IngestModal } from './IngestModal'
import { Library } from './Library'
import { Reader } from './Reader'
import { ReaderToolbar } from './ReaderToolbar'
import type { HighlightColor } from './ReaderToolbar'
import { Sidebar } from './Sidebar'
import type { FooterItem, NavItem } from './Sidebar'
import { TabStrip } from './TabStrip'
import type { PaperTab } from './TabStrip'
import { RightPanel, type RightPanelTab } from './RightPanel'
import type { InjectedPrompt } from './AskPanel'
import type { HighlightRecord } from '../../core/highlights/repo'
import styles from './App.module.css'

// Vellum shell — [P1-07] anara-style frame, [P1-08] wires in real data:
//   top: TabStrip (open papers as tabs — one per opened paper, keyed by slug)
//   left: Sidebar (Create / Home / Library / Search + folder tree); selecting
//     'Library' swaps the center pane to the Library grid; selecting 'Create'
//     opens the IngestModal.
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
  const [view, setView] = useState<'reader' | 'library' | 'trash' | 'usage'>('reader')
  const [isIngestOpen, setIsIngestOpen] = useState(false)
  const [highlightActive, setHighlightActive] = useState(false)
  const [highlightColor, setHighlightColor] = useState<HighlightColor>('yellow')
  const [jumpTarget, setJumpTarget] = useState<{ page: number; highlightId: string; nonce: number } | null>(null)
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('Ask')
  const [injectedPrompt, setInjectedPrompt] = useState<InjectedPrompt | null>(null)
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null)
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<number | null>(null)
  const [chatBanner, setChatBanner] = useState<string | null>(null)
  // Library reached via the Search nav item: highlight Search and focus the
  // title search box. The nonce re-focuses it on repeat clicks.
  const [libraryViaSearch, setLibraryViaSearch] = useState(false)
  const [searchFocusNonce, setSearchFocusNonce] = useState(0)
  // Bumped when a paper is dropped on a sidebar collection so the Library
  // re-reads tags and the filtered list.
  const [libraryRefreshNonce, setLibraryRefreshNonce] = useState(0)

  const activeNavItem: NavItem | null =
    view === 'reader' ? 'Home' : view === 'library' ? (libraryViaSearch ? 'Search' : 'Library') : null
  const activeFooterItem: FooterItem | null = view === 'trash' ? 'Trash' : view === 'usage' ? 'Usage' : null

  async function handleSelectChatSession(session: ChatSessionSummary): Promise<void> {
    setSelectedChatSessionId(session.id)
    try {
      const paper = await window.vellum.getPaper(session.paperSlug)
      if (paper) {
        setChatBanner(null)
        openPaper({ slug: paper.slug, title: paper.title })
        setRightPanelTab('Ask')
      } else {
        setChatBanner(`Chat "${session.title}" references paper "${session.paperSlug}" which was not found in your library.`)
      }
    } catch {
      setChatBanner(`Could not load paper for chat "${session.title}".`)
    }
  }

  function handleSelectCollection(id: number | null, name: string | null): void {
    setSelectedCollectionId(id)
    setSelectedCollectionName(name)
    setLibraryViaSearch(false)
    setView('library')
  }

  function handleAddToChat(quote: string, page: number): void {
    setRightPanelTab('Ask')
    setInjectedPrompt({
      text: `> "${quote}" (p. ${page})

`,
      autoSend: false,
      nonce: Date.now(),
    })
  }

  function handleExplain(quote: string, page: number): void {
    setRightPanelTab('Ask')
    setInjectedPrompt({
      text: `Explain this passage from page ${page}:

> "${quote}"`,
      autoSend: true,
      nonce: Date.now(),
    })
  }

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

  // Plain Library (not reached via Search): no Search highlight or focus.
  function showLibrary(): void {
    setLibraryViaSearch(false)
    setView('library')
  }

  // Close a tab. Closing the active one activates its right neighbour, else
  // its left one, else nothing (the Reader's empty state).
  function closeTab(id: string): void {
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return
    const remaining = tabs.filter((tab) => tab.id !== id)
    setTabs(remaining)
    if (activeTabId === id) {
      const next = remaining[index] ?? remaining[index - 1] ?? null
      setActiveTabId(next ? next.id : null)
    }
  }

  function handleNavChange(item: NavItem): void {
    if (item === 'Create') {
      setIsIngestOpen(true)
    } else if (item === 'Search') {
      setLibraryViaSearch(true)
      setSearchFocusNonce((n) => n + 1)
      setView('library')
    } else {
      setLibraryViaSearch(false)
      if (item === 'Library') {
        // The Library item means "all papers"; collection rows filter.
        setSelectedCollectionId(null)
        setSelectedCollectionName(null)
      }
      setView(item === 'Library' ? 'library' : 'reader')
    }
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
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={showLibrary}
      />
      <div className={styles.body}>
        <Sidebar
          onNavChange={handleNavChange}
          selectedCollectionId={selectedCollectionId}
          onSelectCollection={handleSelectCollection}
          selectedSessionId={selectedChatSessionId}
          onSelectSession={handleSelectChatSession}
          onSelectTrash={() => setView('trash')}
          onSelectUsage={() => setView('usage')}
          activeNavItem={activeNavItem}
          activeFooterItem={activeFooterItem}
          onPaperAssigned={() => setLibraryRefreshNonce((n) => n + 1)}
        />
        <main className={styles.centerPane} aria-label="Paper view">
          {chatBanner && (
            <div role="alert" style={{ background: '#742a2a', color: '#fff', padding: '6px 12px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{chatBanner}</span>
              <button type="button" onClick={() => setChatBanner(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
            </div>
          )}
          {view === 'trash' ? (
            <TrashView
              onBackToLibrary={showLibrary}
            />
          ) : view === 'usage' ? (
            <UsageView
              onBackToLibrary={showLibrary}
            />
          ) : view === 'library' ? (
            <Library
              onOpenPaper={openPaper}
              focusSearchNonce={libraryViaSearch ? searchFocusNonce : 0}
              refreshNonce={libraryRefreshNonce}
              selectedCollectionId={selectedCollectionId}
              selectedCollectionName={selectedCollectionName}
              onClearCollectionFilter={() => {
                setSelectedCollectionId(null)
                setSelectedCollectionName(null)
              }}
              onTrashPaper={(slug) => {
                setTabs((current) => current.filter((tab) => tab.id !== slug))
                if (activeTabId === slug) {
                  const remaining = tabs.filter((tab) => tab.id !== slug)
                  setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
                }
              }}
            />
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
                onAddToChat={handleAddToChat}
                onExplain={handleExplain}
              />
            </>
          )}
        </main>
        <RightPanel
          slug={activeTabId ?? undefined}
          activeTab={rightPanelTab}
          onTabChange={setRightPanelTab}
          onJumpToHighlight={jumpToHighlight}
          injectedPrompt={injectedPrompt}
          targetSessionId={selectedChatSessionId}
        />
      </div>
      <IngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onSuccess={(paper) => {
          setIsIngestOpen(false)
          openPaper(paper)
        }}
      />
      <footer className={styles.statusBar}>
        <span>Vellum</span>
        <span className={styles.statusBarSpacer} />
        <span>bridge: {pong}</span>
      </footer>
    </div>
  )
}
