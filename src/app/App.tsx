import { TrashView } from './TrashView.js'
import { UsageView } from './UsageView.js'
import type { ChatSessionSummary } from '../../core/chat/repo'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  // Invalidation counts only; durable highlight records remain in storage.
  const [highlightRevisions, setHighlightRevisions] = useState<Record<string, number>>({})
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('Ask')
  const [injectedPrompt, setInjectedPrompt] = useState<InjectedPrompt | null>(null)
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null)
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<number | null>(null)
  const [deletedSessionIds, setDeletedSessionIds] = useState<readonly number[]>([])
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

  // App owns navigation. A lookup may commit only while its request is current.
  const chatNavigation = useRef<{ sessionId: number } | null>(null)

  async function handleSelectChatSession(session: ChatSessionSummary): Promise<void> {
    if (deletedSessionIds.includes(session.id)) return
    const request = { sessionId: session.id }
    chatNavigation.current = request
    try {
      const paper = await window.vellum.getPaper(session.paperSlug)
      if (chatNavigation.current !== request) return
      if (paper) {
        setChatBanner(null)
        openPaper({ slug: paper.slug, title: paper.title })
        setSelectedChatSessionId(session.id)
        setRightPanelTab('Ask')
      } else {
        setChatBanner(`Chat "${session.title}" references paper "${session.paperSlug}" which was not found in your library.`)
      }
    } catch {
      if (chatNavigation.current !== request) return
      setChatBanner(`Could not load paper for chat "${session.title}".`)
    }
  }

  function navigateView(next: typeof view): void {
    chatNavigation.current = null
    setView(next)
  }

  function handleSessionDeleted(id: number): void {
    if (chatNavigation.current?.sessionId === id) chatNavigation.current = null
    setDeletedSessionIds((ids) => [...ids, id])
  }

  function handleSelectCollection(id: number | null, name: string | null): void {
    setSelectedCollectionId(id)
    setSelectedCollectionName(name)
    setLibraryViaSearch(false)
    navigateView('library')
  }

  function handleAddToChat(quote: string, page: number): void {
    setRightPanelTab('Ask')
    setInjectedPrompt({
      text: `> "${quote}" (p. ${page})

`,
      autoSend: false,
      nonce: Date.now(),
      slug: activeTabId ?? undefined,
    })
  }

  function handleExplain(quote: string, page: number): void {
    setRightPanelTab('Ask')
    setInjectedPrompt({
      text: `Explain this passage from page ${page}:

> "${quote}"`,
      autoSend: true,
      nonce: Date.now(),
      slug: activeTabId ?? undefined,
    })
  }

  const handleInjectedPromptHandled = useCallback((nonce: number): void => {
    setInjectedPrompt((current) => (current?.nonce === nonce ? null : current))
  }, [])

  useEffect(() => {
    window.vellum?.ping().then(setPong).catch(() => setPong('no-bridge'))
  }, [])

  function openPaper(paper: { slug: string; title: string }): void {
    setTabs((current) => (current.some((tab) => tab.id === paper.slug) ? current : [...current, { id: paper.slug, title: paper.title }]))
    if (paper.slug !== activeTabId) setSelectedChatSessionId(null)
    setActiveTabId(paper.slug)
    navigateView('reader')
  }

  function selectTab(id: string): void {
    if (id !== activeTabId) setSelectedChatSessionId(null)
    setActiveTabId(id)
    navigateView('reader')
  }

  // Plain Library (not reached via Search): no Search highlight or focus.
  function showLibrary(): void {
    setLibraryViaSearch(false)
    navigateView('library')
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
      navigateView('library')
    } else {
      setLibraryViaSearch(false)
      if (item === 'Library') {
        // The Library item means "all papers"; collection rows filter.
        setSelectedCollectionId(null)
        setSelectedCollectionName(null)
      }
      navigateView(item === 'Library' ? 'library' : 'reader')
    }
  }

  // [P2-02] Annotations tab -> Reader jump seam. `nonce` (not just page/id)
  // so clicking the same annotation twice in a row re-triggers the flash —
  // Reader's jump effect keys off this whole object changing, not just its
  // page/highlightId fields.
  function jumpToHighlight(highlight: HighlightRecord): void {
    setJumpTarget({ page: highlight.page, highlightId: highlight.id, nonce: Date.now() })
  }

  function handleHighlightsChanged(paperSlug: string): void {
    setHighlightRevisions((current) => ({ ...current, [paperSlug]: (current[paperSlug] ?? 0) + 1 }))
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
          onSessionDeleted={handleSessionDeleted}
          onSelectTrash={() => navigateView('trash')}
          onSelectUsage={() => navigateView('usage')}
          activeNavItem={activeNavItem}
          activeFooterItem={activeFooterItem}
          onPaperAssigned={() => setLibraryRefreshNonce((n) => n + 1)}
          onCollectionsChanged={() => setLibraryRefreshNonce((n) => n + 1)}
        />
        <main className={styles.centerPane} aria-label="Paper view">
          {chatBanner && (
            <div role="alert" className={styles.chatBanner}>
              <span>{chatBanner}</span>
              <button type="button" aria-label="Dismiss chat navigation error" onClick={() => setChatBanner(null)} className={styles.dismissBanner}>✕</button>
            </div>
          )}
          <div className={styles.centerContent}>
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
                  navigateView('library')
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
                  onHighlightCreated={handleHighlightsChanged}
                  highlightsRevision={activeTabId ? highlightRevisions[activeTabId] ?? 0 : 0}
                  onAddToChat={handleAddToChat}
                  onExplain={handleExplain}
                />
              </>
            )}
          </div>
        </main>
        <RightPanel
          slug={activeTabId ?? undefined}
          activeTab={rightPanelTab}
          onTabChange={setRightPanelTab}
          onJumpToHighlight={jumpToHighlight}
          onHighlightDeleted={handleHighlightsChanged}
          highlightsRevision={activeTabId ? highlightRevisions[activeTabId] ?? 0 : 0}
          injectedPrompt={injectedPrompt}
          onInjectedPromptHandled={handleInjectedPromptHandled}
          targetSessionId={selectedChatSessionId}
          deletedSessionIds={deletedSessionIds}
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
