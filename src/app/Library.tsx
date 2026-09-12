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
  selectedCollectionId?: number | null
  selectedCollectionName?: string | null
  onClearCollectionFilter?: () => void
  /** [L2-04] Callback when a paper is moved to Trash. */
  onTrashPaper?: (slug: string) => void
}

const SORT_OPTIONS: { value: PaperSortColumn; label: string }[] = [
  { value: 'addedAt', label: 'Recently added' },
  { value: 'year', label: 'Year' },
  { value: 'title', label: 'Title' },
]

type Status = 'loading' | 'ready' | 'error'

export function Library({
  onOpenPaper,
  selectedCollectionId = null,
  selectedCollectionName = null,
  onClearCollectionFilter,
  onTrashPaper,
}: LibraryProps): JSX.Element {
  const [papers, setPapers] = useState<PaperRecord[]>([])
  const [paperCollections, setPaperCollections] = useState<Record<string, string[]>>({})
  const [status, setStatus] = useState<Status>('loading')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PaperSortColumn>('addedAt')
  const handleTrashPaper = async (e: React.MouseEvent, slug: string): Promise<void> => {
    e.stopPropagation()
    try {
      if (window.vellum?.paperTrash) {
        await window.vellum.paperTrash(slug)
      }
      setPapers((prev) => prev.filter((p) => p.slug !== slug))
      onTrashPaper?.(slug)
    } catch (err) {
      console.error('Failed to move paper to trash:', err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    const options: ListPapersOptions = {
      search: search.trim() || undefined,
      collectionId: selectedCollectionId ?? undefined,
      sort,
      order: sort === 'title' ? 'asc' : 'desc',
    }

    window.vellum
      .listPapers(options)
      .then(async (rows) => {
        if (cancelled) return
        setPapers(rows)
        setStatus('ready')

        // Fetch collection tags for displayed papers
        if (window.vellum?.collectionsForPaper) {
          const tags: Record<string, string[]> = {}
          for (const paper of rows) {
            try {
              const colls = await window.vellum.collectionsForPaper(paper.slug)
              tags[paper.slug] = colls.map((c) => c.name)
            } catch {
              // ignore error
            }
          }
          if (!cancelled) setPaperCollections(tags)
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [search, sort, selectedCollectionId])

  return (
    <div className={styles.library}>
      {selectedCollectionId !== null && (
        <div className={styles.filterBanner} role="status">
          <span>
            Filtered by collection: <strong>{selectedCollectionName || 'Collection'}</strong>
          </span>
          <button
            type="button"
            className={styles.clearFilterButton}
            onClick={onClearCollectionFilter}
          >
            Clear filter
          </button>
        </div>
      )}
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
            <div
              key={paper.slug}
              role="listitem"
              className={styles.card}
            >
              <div className={styles.cardHeader}>
                <button
                  type="button"
                  className={styles.cardTitleButton}
                  onClick={() => onOpenPaper({ slug: paper.slug, title: paper.title })}
                >
                  <span className={styles.cardTitle}>{paper.title}</span>
                </button>
                <button
                  type="button"
                  className={styles.trashCardButton}
                  aria-label={`Move ${paper.title} to trash`}
                  title="Move to trash"
                  onClick={(e) => void handleTrashPaper(e, paper.slug)}
                >
                  🗑️
                </button>
              </div>
              <div
                className={styles.cardBody}
                onClick={() => onOpenPaper({ slug: paper.slug, title: paper.title })}
              >
                <span className={styles.cardMeta}>
                  {formatAuthors(paper.authors)}
                  {paper.year ? ` · ${paper.year}` : ''}
                </span>
                {paperCollections[paper.slug] && paperCollections[paper.slug].length > 0 && (
                  <div className={styles.collectionsTagList}>
                    {paperCollections[paper.slug].map((cName) => (
                      <span key={cName} className={styles.collectionTag}>
                        {cName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
