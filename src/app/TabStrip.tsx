// Top tab strip — one tab per open paper. [P1-07] was layout-only (`tabs`
// defaulted to empty, showing the strip's empty state). [P1-08] wires real
// tab data in: App.tsx owns `tabs`/`activeTabId` state (one tab per opened
// paper, keyed by slug) and passes `onSelectTab` down so clicking a tab
// switches which paper the Reader shows.
import styles from './TabStrip.module.css'

export interface PaperTab {
  id: string
  title: string
}

interface TabStripProps {
  tabs?: PaperTab[]
  activeTabId?: string | null
  onSelectTab?: (id: string) => void
  /** Close a tab (close button or middle-click). App decides which tab
   * becomes active next. */
  onCloseTab?: (id: string) => void
  /** "+" button — App opens the Library so another paper can be opened. */
  onNewTab?: () => void
}

export function TabStrip({
  tabs = [],
  activeTabId = null,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TabStripProps): JSX.Element {
  return (
    <div className={styles.tabStrip} role="tablist" aria-label="Open papers">
      {tabs.length === 0 ? (
        <div className={styles.empty}>No papers open — open one from Library</div>
      ) : (
        tabs.map((tab) => (
          <div
            key={tab.id}
            role="presentation"
            className={tab.id === activeTabId ? `${styles.tabItem} ${styles.tabActive}` : styles.tabItem}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={styles.tab}
              title={tab.title}
              onClick={() => onSelectTab?.(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1 && onCloseTab) {
                  event.preventDefault()
                  onCloseTab(tab.id)
                }
              }}
            >
              {tab.title}
            </button>
            {onCloseTab ? (
              <button
                type="button"
                className={styles.closeButton}
                aria-label={`Close ${tab.title}`}
                title="Close tab"
                onClick={() => onCloseTab(tab.id)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))
      )}
      <button
        type="button"
        className={styles.newTabButton}
        aria-label="Open another paper"
        title="Open another paper from the Library"
        disabled={!onNewTab}
        onClick={onNewTab}
      >
        +
      </button>
    </div>
  )
}
