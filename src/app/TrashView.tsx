// [L2-04] TrashView: lists soft-deleted papers with restore and permanent purge actions.
import { useState, useEffect } from 'react'
import type { PaperRecord } from '../../core/library/repo.js'
import styles from './TrashView.module.css'

export interface TrashViewProps {
  onBackToLibrary?: () => void
  onPaperRestored?: (slug: string) => void
}

export function TrashView({ onBackToLibrary, onPaperRestored }: TrashViewProps): JSX.Element {
  const [trashedPapers, setTrashedPapers] = useState<PaperRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmPurgeTarget, setConfirmPurgeTarget] = useState<PaperRecord | null>(null)
  const [purging, setPurging] = useState(false)

  const loadTrash = async (): Promise<void> => {
    try {
      setLoading(true)
      setError(null)
      const papers = await window.vellum.listPapers({ trashed: true })
      setTrashedPapers(papers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trashed papers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTrash()
  }, [])

  const handleRestore = async (paper: PaperRecord): Promise<void> => {
    try {
      setError(null)
      await window.vellum.paperRestore(paper.slug)
      setTrashedPapers((prev) => prev.filter((p) => p.slug !== paper.slug))
      onPaperRestored?.(paper.slug)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore paper')
    }
  }

  const handlePurge = async (): Promise<void> => {
    if (!confirmPurgeTarget) return
    try {
      setPurging(true)
      setError(null)
      await window.vellum.paperPurge(confirmPurgeTarget.slug)
      setTrashedPapers((prev) => prev.filter((p) => p.slug !== confirmPurgeTarget.slug))
      setConfirmPurgeTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to permanently delete paper')
    } finally {
      setPurging(false)
    }
  }

  const formatAuthors = (authors: string[]): string => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length <= 2) return authors.join(' & ')
    return `${authors[0]} et al.`
  }

  return (
    <div className={styles.container} role="region" aria-label="Trash view">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>Trash</h2>
          <span className={styles.count}>
            {trashedPapers.length} {trashedPapers.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        {onBackToLibrary && (
          <button
            type="button"
            className={styles.backButton}
            onClick={onBackToLibrary}
          >
            ← Back to Library
          </button>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.emptyState}>Loading trash…</div>
      ) : trashedPapers.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🗑️</div>
          <div>Trash is empty</div>
        </div>
      ) : (
        <ul className={styles.list} role="list" aria-label="Trashed papers">
          {trashedPapers.map((paper) => (
            <li key={paper.slug} className={styles.item} role="listitem">
              <div className={styles.itemContent}>
                <div className={styles.paperTitle} title={paper.title}>
                  {paper.title}
                </div>
                <div className={styles.paperMeta}>
                  {formatAuthors(paper.authors)}
                  {paper.year ? ` · ${paper.year}` : ''}
                  {paper.trashedAt
                    ? ` · Trashed ${new Date(paper.trashedAt).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={styles.restoreButton}
                  aria-label={`Restore ${paper.title}`}
                  onClick={() => void handleRestore(paper)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={styles.purgeButton}
                  aria-label={`Delete ${paper.title} permanently`}
                  onClick={() => setConfirmPurgeTarget(paper)}
                >
                  Delete permanently
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmPurgeTarget && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="purge-title">
          <div className={styles.modal}>
            <h3 id="purge-title" className={styles.modalTitle}>
              Permanently delete paper?
            </h3>
            <p className={styles.modalMessage}>
              Are you sure you want to permanently delete &ldquo;{confirmPurgeTarget.title}&rdquo;?
              This will remove all associated notes, highlights, chat sessions, and downloaded files from your device.
              This action cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelButton}
                aria-label="Cancel purge"
                disabled={purging}
                onClick={() => setConfirmPurgeTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmDeleteButton}
                aria-label="Confirm purge"
                disabled={purging}
                onClick={() => void handlePurge()}
              >
                {purging ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
