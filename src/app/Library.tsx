// Library grid — [P1-08]. Lists ingested papers from SQLite (via
// window.vellum.listPapers, core/library/repo.ts -> electron/main.ts IPC),
// with basic title search + sort. Clicking a card hands the paper's
// {slug, title} up to the caller (App.tsx) to open as a tab — this
// component owns no tab/reader state itself.
//
// `PaperRecord`/`ListPapersOptions` are TYPE-ONLY imports from core/ — erased
// at compile time, so this stays consistent with "renderer never imports
// node" (the same pattern electron/preload.ts and src/vellum.d.ts already use
// for IngestResult/VellumApi).
import { useEffect, useState } from 'react'
import type { ListPapersOptions, PaperRecord, PaperSortColumn } from '../../core/library/repo'
import styles from './Library.module.css'

export interface LibraryProps {
  onOpenPaper: (paper: { slug: string; title: string }) => void
}

const SORT_OPTIONS: { value: PaperSortColumn; label: string }[] = [
  { value: 'addedAt', label: 'Recently added' },
  { value: 'year', label: 'Year' },
  { value: 'title', label: 'Title' },
]

type Status = 'loading' | 'ready' | 'error'

export function Library({ onOpenPaper }: LibraryProps): JSX.Element {
  const [papers, setPapers] = useState<PaperRecord[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PaperSortColumn>('addedAt')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    const options: ListPapersOptions = {
      search: search.trim() || undefined,
      sort,
      order: sort === 'title' ? 'asc' : 'desc',
    }

    window.vellum
      .listPapers(options)
      .then((rows) => {
        if (cancelled) return
        setPapers(rows)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [search, sort])

  return (
    <div className={styles.library}>
      <div className={styles.controls}>
        <input
          type="search"
          aria-label="Search papers by title"
          placeholder="Search title…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Sort papers"
          value={sort}
          onChange={(event) => setSort(event.target.value as PaperSortColumn)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {status === 'error' ? (
        <p className={styles.empty}>Could not load your library.</p>
      ) : status === 'ready' && papers.length === 0 ? (
        <p className={styles.empty}>
          {search.trim() ? 'No papers match your search.' : 'No papers yet — ingest one to get started.'}
        </p>
      ) : (
        <div className={styles.grid} role="list" aria-label="Papers">
          {papers.map((paper) => (
            <button
              key={paper.slug}
              type="button"
              role="listitem"
              className={styles.card}
              onClick={() => onOpenPaper({ slug: paper.slug, title: paper.title })}
            >
              <span className={styles.cardTitle}>{paper.title}</span>
              <span className={styles.cardMeta}>
                {formatAuthors(paper.authors)}
                {paper.year ? ` · ${paper.year}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return ''
  if (authors.length <= 3) return authors.join(', ')
  return `${authors.slice(0, 3).join(', ')} et al.`
}
