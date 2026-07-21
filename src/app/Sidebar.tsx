// Left sidebar — primary nav (Create / Home / Library / Search) + a folder
// tree placeholder. [P1-07] is layout-only: nav items render but don't route
// anywhere yet, and the folder tree is an empty-state stub (real tree lands
// with collections, Phase-2 backlog).
import { useState } from 'react'
import styles from './Sidebar.module.css'

const NAV_ITEMS = ['Create', 'Home', 'Library', 'Search'] as const
type NavItem = (typeof NAV_ITEMS)[number]

export function Sidebar(): JSX.Element {
  const [active, setActive] = useState<NavItem>('Home')

  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <ul className={styles.navList}>
        {NAV_ITEMS.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={item === active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
              aria-current={item === active ? 'page' : undefined}
              onClick={() => setActive(item)}
            >
              {item}
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.folderTree}>
        <p className={styles.folderTreeHeading}>Folders</p>
        <p className={styles.folderTreeEmpty}>No folders yet</p>
      </div>
    </nav>
  )
}
