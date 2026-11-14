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
import { useEffect, useRef, useState } from 'react'
import type { ListPapersOptions, PaperRecord, PaperSortColumn } from '../../core/library/repo'
import type { CollectionRecord } from '../../core/collections/repo'
import styles from './Library.module.css'

/** Drag-data type a Library card carries; CollectionsTree rows accept it. */
export const PAPER_DRAG_TYPE = 'application/x-vellum-paper'

export interface LibraryProps {
  onOpenPaper: (paper: { slug: string; title: string }) => void
  selectedCollectionId?: number | null
  selectedCollectionName?: string | null
  onClearCollectionFilter?: () => void
  /** [L2-04] Callback when a paper is moved to Trash. */
  onTrashPaper?: (slug: string) => void
  /** Focus the title search box whenever this changes (and on mount when
   * non-zero) — the sidebar's Search item. */
  focusSearchNonce?: number
  /** Re-query papers and collections whenever this changes (App bumps it
   * after a paper is dropped onto a sidebar collection). */
  refreshNonce?: number
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
  focusSearchNonce = 0,
  refreshNonce = 0,
}: LibraryProps): JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusSearchNonce > 0) searchInputRef.current?.focus()
  }, [focusSearchNonce])
  const [papers, setPapers] = useState<PaperRecord[]>([])
  const [paperCollections, setPaperCollections] = useState<Record<string, CollectionRecord[]>>({})
  const [collections, setCollections] = useState<CollectionRecord[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PaperSortColumn>('addedAt')
  const [actionError, setActionError] = useState<string | null>(null)
  const handleTrashPaper = async (
    e: React.MouseEvent,
    paper: Pick<PaperRecord, 'slug' | 'title'>,
  ): Promise<void> => {
    e.stopPropagation()
    try {
      if (window.vellum?.paperTrash) {
        await window.vellum.paperTrash(paper.slug)
      }
      setActionError(null)
      setPapers((prev) => prev.filter((p) => p.slug !== paper.slug))
      onTrashPaper?.(paper.slug)
    } catch (err) {
      console.error('Failed to move paper to trash:', err)
      setActionError(`Could not move "${paper.title}" to Trash: ${errorMessage(err)}`)
    }
  }

  // All collections, for each card's "Add to collection" control.
  useEffect(() => {
    let cancelled = false
    window.vellum?.collectionsList?.()
      .then((rows) => {
        if (!cancelled) setCollections(rows)
      })
      .catch(() => {
        // Control just offers nothing; the sidebar tree surfaces load errors.
      })
    return () => {
      cancelled = true
    }
  }, [refreshNonce])

  async function loadPaperCollections(slug: string): Promise<void> {
    if (!window.vellum?.collectionsForPaper) return
    try {
      const rows = await window.vellum.collectionsForPaper(slug)
      setPaperCollections((prev) => ({ ...prev, [slug]: rows }))
    } catch {
      // Keep the previous tags.
    }
  }

  async function handleAssign(paper: PaperRecord, collectionId: number): Promise<void> {
    try {
      await window.vellum.collectionsAssign({ paperSlug: paper.slug, collectionId })
      await loadPaperCollections(paper.slug)
    } catch (err) {
      console.error('Failed to add paper to collection:', err)
    }
  }

  async function handleRemoveFromCollection(paper: PaperRecord, collectionId: number): Promise<void> {
    try {
      await window.vellum.collectionsRemove({ paperSlug: paper.slug, collectionId })
      setPapers((prev) => prev.filter((p) => p.slug !== paper.slug))
    } catch (err) {
      console.error('Failed to remove paper from collection:', err)
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
          const tags: Record<string, CollectionRecord[]> = {}
          for (const paper of rows) {
            try {
              tags[paper.slug] = await window.vellum.collectionsForPaper(paper.slug)
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
  }, [search, sort, selectedCollectionId, refreshNonce])

  const collectionPaths = collectionPathNames(collections)

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
          ref={searchInputRef}
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

      {actionError && (
        <div className={styles.actionError} role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className={styles.dismissButton}
            aria-label="Dismiss error"
            onClick={() => setActionError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {status === 'error' ? (
        <p className={styles.empty}>Could not load your library.</p>
      ) : status === 'ready' && papers.length === 0 ? (
        <p className={styles.empty}>
          {search.trim()
            ? 'No papers match your search.'
            : selectedCollectionId !== null
              ? 'No papers in this collection yet. Drag a paper card onto the collection in the sidebar, or use “Add to collection…” on a card.'
              : 'No papers yet — ingest one to get started.'}
        </p>
      ) : (
        <div className={styles.grid} role="list" aria-label="Papers">
          {papers.map((paper) => (
            <div
              key={paper.slug}
              role="listitem"
              className={styles.card}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(PAPER_DRAG_TYPE, paper.slug)
                event.dataTransfer.setData('text/plain', paper.title)
                event.dataTransfer.effectAllowed = 'copy'
              }}
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
                  onClick={(e) => void handleTrashPaper(e, paper)}
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
                    {paperCollections[paper.slug].map((collection) => (
                      <span key={collection.id} className={styles.collectionTag}>
                        {collection.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.cardActions}>
                {collections.length > 0 && (
                  <select
                    className={styles.collectionSelect}
                    aria-label={`Add to collection: ${paper.title}`}
                    value=""
                    onChange={(event) => {
                      const id = Number(event.target.value)
                      if (id > 0) void handleAssign(paper, id)
                    }}
                  >
                    <option value="">Add to collection…</option>
                    {collections
                      .filter((collection) => !paperCollections[paper.slug]?.some((c) => c.id === collection.id))
                      .map((collection) => (
                        <option key={collection.id} value={collection.id}>
                          {collectionPaths.get(collection.id) ?? collection.name}
                        </option>
                      ))}
                  </select>
                )}
                {selectedCollectionId !== null && (
                  <button
                    type="button"
                    className={styles.removeFromCollectionButton}
                    aria-label={`Remove from collection: ${paper.title}`}
                    onClick={() => void handleRemoveFromCollection(paper, selectedCollectionId)}
                  >
                    Remove from collection
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Electron wraps main-process throws as "Error invoking remote method '<channel>': Error: <msg>";
// show only <msg> to the user.
function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return ''
  if (authors.length <= 3) return authors.join(', ')
  return `${authors.slice(0, 3).join(', ')} et al.`
}

/** "Parent / Child" display names for a flat collection list. */
function collectionPathNames(collections: CollectionRecord[]): Map<number, string> {
  const byId = new Map(collections.map((c) => [c.id, c]))
  const names = new Map<number, string>()
  for (const collection of collections) {
    const parts: string[] = []
    const seen = new Set<number>()
    let current: CollectionRecord | undefined = collection
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      parts.unshift(current.name)
      current = current.parentId === null ? undefined : byId.get(current.parentId)
    }
    names.set(collection.id, parts.join(' / '))
  }
  return names
}
