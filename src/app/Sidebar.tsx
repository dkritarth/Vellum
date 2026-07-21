// Left sidebar — workspace switcher + primary nav (Create / Home / Library /
// Search) + a Files/Chats view toggle + footer (Trash / Usage). [P1-07] was
// layout-only for nav; [P1-14] fills in the rest of anara's sidebar chrome as
// visible "coming soon" stubs (folder tree, Chats, Trash, Usage, workspace
// switcher) so nothing in the shell is a dead or invisible button.
import { useState } from 'react'
import { ComingSoon } from './ComingSoon'
import styles from './Sidebar.module.css'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const NAV_ITEMS = ['Create', 'Home', 'Library', 'Search'] as const
type NavItem = (typeof NAV_ITEMS)[number]

const LIBRARY_VIEWS = ['Files', 'Chats'] as const
type LibraryView = (typeof LIBRARY_VIEWS)[number]

const FOOTER_ITEMS = ['Trash', 'Usage'] as const
type FooterItem = (typeof FOOTER_ITEMS)[number]

const FOOTER_NOTES: Record<FooterItem, string> = {
  Trash: 'Soft-delete + restore — wiki card [P2-08]',
  Usage: 'Plan-credit / token usage — wiki card [P2-09]',
}

export function Sidebar(): JSX.Element {
  const [active, setActive] = useState<NavItem>('Home')
  const [libraryView, setLibraryView] = useState<LibraryView>('Files')
  const [footerView, setFooterView] = useState<FooterItem | null>(null)

  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <WorkspaceSwitcher />

      <ul className={styles.navList}>
        {NAV_ITEMS.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={item === active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
              aria-current={item === active ? 'page' : undefined}
              onClick={() => {
                setActive(item)
                setFooterView(null)
              }}
            >
              {item}
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.viewToggle} role="tablist" aria-label="Library view">
        {LIBRARY_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={view === libraryView}
            className={
              view === libraryView ? `${styles.viewToggleButton} ${styles.viewToggleButtonActive}` : styles.viewToggleButton
            }
            onClick={() => {
              setLibraryView(view)
              setFooterView(null)
            }}
          >
            {view}
          </button>
        ))}
      </div>

      <div className={styles.viewPanel} role="tabpanel">
        {footerView ? (
          <ComingSoon label={footerView} note={FOOTER_NOTES[footerView]} />
        ) : libraryView === 'Files' ? (
          <ComingSoon label="Folders" note="Folder tree / collections — wiki card [P2-05]" />
        ) : (
          <ComingSoon label="Chats" note="Chats library view — wiki card [P2-06]" />
        )}
      </div>

      <div className={styles.footer}>
        {FOOTER_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === footerView ? `${styles.footerItem} ${styles.footerItemActive}` : styles.footerItem}
            aria-pressed={item === footerView}
            onClick={() => setFooterView((current) => (current === item ? null : item))}
          >
            {item}
          </button>
        ))}
      </div>
    </nav>
  )
}
