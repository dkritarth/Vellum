import { useEffect, useRef, useState } from 'react'
import type { CollectionTreeItem } from '../../electron/preload'
import styles from './CollectionsTree.module.css'
import { PAPER_DRAG_TYPE } from './Library'

export interface CollectionsTreeProps {
  selectedCollectionId: number | null
  onSelectCollection: (id: number | null, name: string | null) => void
  /** A Library card was dropped on a collection and assigned to it. */
  onPaperAssigned?: (collectionId: number) => void
  /** A collection was created, renamed or deleted. */
  onCollectionsChanged?: () => void
}

/** Enter/Space on the row itself (not a nested button or input) selects it. */
function selectOnKey(event: React.KeyboardEvent, select: () => void): void {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    select()
  }
}

function carriesPaper(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(PAPER_DRAG_TYPE)
}

export function CollectionsTree({
  selectedCollectionId,
  onSelectCollection,
  onPaperAssigned,
  onCollectionsChanged,
}: CollectionsTreeProps): JSX.Element {
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [tree, setTree] = useState<CollectionTreeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingParentId, setCreatingParentId] = useState<number | null | 'root'>(null)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  // Polled every second: setting the same string again is a React no-op, so a
  // persistent failure renders one stable message rather than a new one per tick.
  const [loadError, setLoadError] = useState<string | null>(null)

  // Initial load, polls, and mutation reloads share one publication owner.
  const mounted = useRef(false)
  const refreshSequence = useRef(0)
  const currentSelection = useRef({ selectedCollectionId, onSelectCollection })

  useEffect(() => {
    currentSelection.current = { selectedCollectionId, onSelectCollection }
  }, [selectedCollectionId, onSelectCollection])

  async function refreshTree(): Promise<void> {
    if (!mounted.current) return
    const sequence = ++refreshSequence.current
    const isCurrent = () => mounted.current && sequence === refreshSequence.current
    try {
      if (window.vellum?.collectionsTree) {
        const data = await window.vellum.collectionsTree()
        if (!isCurrent()) return
        setTree(data)
        setLoadError(null)
      }
    } catch (err) {
      if (!isCurrent()) return
      setLoadError(`Could not load collections: ${errorMessage(err)}`)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    void refreshTree()
    const interval = setInterval(refreshTree, 1000)
    return () => {
      mounted.current = false
      ++refreshSequence.current
      clearInterval(interval)
    }
  }, [])

  async function handleCreateSubmit(): Promise<void> {
    const name = newCollectionName.trim()
    if (!name) return

    const parentId = creatingParentId === 'root' ? null : creatingParentId
    try {
      const created = await window.vellum.collectionsCreate({ name, parentId })
      setActionError(null)
      setNewCollectionName('')
      setCreatingParentId(null)
      await refreshTree()
      onCollectionsChanged?.()
      onSelectCollection(created.id, created.name)
    } catch (err) {
      console.error('Failed to create collection', err)
      setActionError(`Could not create collection "${name}": ${errorMessage(err)}`)
    }
  }

  async function handleRenameSubmit(id: number): Promise<void> {
    const name = editingName.trim()
    if (!name) return

    try {
      await window.vellum.collectionsRename({ id, name })
      setActionError(null)
      setEditingId(null)
      setEditingName('')
      await refreshTree()
      onCollectionsChanged?.()
      if (selectedCollectionId === id) {
        onSelectCollection(id, name)
      }
    } catch (err) {
      console.error('Failed to rename collection', err)
      setActionError(`Could not rename collection to "${name}": ${errorMessage(err)}`)
    }
  }

  async function handleDelete(id: number, name: string): Promise<void> {
    if (!window.confirm(`Delete collection "${name}" and all subcollections? Papers will not be deleted.`)) {
      return
    }

    // Retain the subtree before deletion/polling removes its visible rows.
    const deletedIds = new Set([id])
    function collectSubtree(nodes: CollectionTreeItem[], deleting = false): void {
      for (const node of nodes) {
        const inSubtree = deleting || node.id === id
        if (inSubtree) deletedIds.add(node.id)
        collectSubtree(node.children, inSubtree)
      }
    }
    collectSubtree(tree)

    try {
      await window.vellum.collectionsDelete(id)
      setActionError(null)
      const selection = currentSelection.current
      if (selection.selectedCollectionId !== null && deletedIds.has(selection.selectedCollectionId)) {
        selection.onSelectCollection(null, null)
      }
      await refreshTree()
      onCollectionsChanged?.()
    } catch (err) {
      console.error('Failed to delete collection', err)
      setActionError(`Could not delete collection "${name}": ${errorMessage(err)}`)
    }
  }

  async function handleDrop(event: React.DragEvent, collectionId: number): Promise<void> {
    setDropTargetId(null)
    if (!carriesPaper(event)) return
    event.preventDefault()
    const paperSlug = event.dataTransfer.getData(PAPER_DRAG_TYPE)
    if (!paperSlug) return
    try {
      await window.vellum.collectionsAssign({ paperSlug, collectionId })
      setActionError(null)
      await refreshTree()
      onPaperAssigned?.(collectionId)
    } catch (err) {
      console.error('Failed to add paper to collection', err)
      setActionError(`Could not add paper to collection: ${errorMessage(err)}`)
    }
  }

  function renderTreeNodes(nodes: CollectionTreeItem[], depth = 0): JSX.Element[] {
    return nodes.map((node) => {
      const isSelected = selectedCollectionId === node.id
      const isEditing = editingId === node.id

      return (
        <div key={node.id}>
          {isEditing ? (
            <div className={styles.inputRow} style={{ paddingLeft: `${depth * 14 + 6}px` }}>
              <input
                type="text"
                className={styles.nameInput}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRenameSubmit(node.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                autoFocus
              />
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={() => void handleRenameSubmit(node.id)}
              >
                Save
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setEditingId(null)}
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              className={`${styles.treeItem} ${isSelected ? styles.treeItemActive : ''} ${
                dropTargetId === node.id ? styles.dropTarget : ''
              }`}
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
              onClick={() => onSelectCollection(node.id, node.name)}
              onKeyDown={(event) => selectOnKey(event, () => onSelectCollection(node.id, node.name))}
              tabIndex={0}
              onDragOver={(event) => {
                if (!carriesPaper(event)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                if (dropTargetId !== node.id) setDropTargetId(node.id)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null)
              }}
              onDrop={(event) => void handleDrop(event, node.id)}
              role="treeitem"
              aria-selected={isSelected}
            >
              <div className={styles.itemLabel}>
                <span className={styles.folderIcon}>📁</span>
                <span className={styles.collectionName} title={node.name}>
                  {node.name}
                </span>
              </div>
              <div className={styles.itemActions} onClick={(e) => e.stopPropagation()}>
                <span className={styles.countBadge}>{node.paperCount}</span>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Add subcollection"
                  aria-label={`Add subcollection to ${node.name}`}
                  onClick={() => {
                    setCreatingParentId(node.id)
                    setNewCollectionName('')
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Rename collection"
                  aria-label={`Rename ${node.name}`}
                  onClick={() => {
                    setEditingId(node.id)
                    setEditingName(node.name)
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Delete collection"
                  aria-label={`Delete ${node.name}`}
                  onClick={() => void handleDelete(node.id, node.name)}
                >
                  🗑
                </button>
              </div>
            </div>
          )}

          {/* Inline creation for children of this node */}
          {creatingParentId === node.id && (
            <div className={styles.inputRow} style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}>
              <input
                type="text"
                className={styles.nameInput}
                placeholder="Subcollection name..."
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateSubmit()
                  if (e.key === 'Escape') setCreatingParentId(null)
                }}
                autoFocus
              />
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={() => void handleCreateSubmit()}
              >
                Add
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setCreatingParentId(null)}
              >
                ✕
              </button>
            </div>
          )}

          {node.children && node.children.length > 0 && (
            <div>{renderTreeNodes(node.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  return (
    <div className={styles.container} role="tree" aria-label="Collections">
      <div className={styles.header}>
        <span>Collections</span>
        <button
          type="button"
          className={styles.addButton}
          title="New Collection"
          aria-label="New Collection"
          onClick={() => {
            setCreatingParentId('root')
            setNewCollectionName('')
          }}
        >
          +
        </button>
      </div>

      {actionError && (
        <div className={styles.actionError} role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className={styles.dismissButton}
            aria-label="Dismiss collection error"
            onClick={() => setActionError(null)}
          >
            ✕
          </button>
        </div>
      )}

      <div
        className={`${styles.allPapersItem} ${selectedCollectionId === null ? styles.allPapersActive : ''}`}
        onClick={() => onSelectCollection(null, null)}
        onKeyDown={(event) => selectOnKey(event, () => onSelectCollection(null, null))}
        tabIndex={0}
        role="treeitem"
        aria-selected={selectedCollectionId === null}
      >
        <div className={styles.itemLabel}>
          <span>📚</span>
          <span>All Papers</span>
        </div>
      </div>

      {creatingParentId === 'root' && (
        <div className={styles.inputRow}>
          <input
            type="text"
            className={styles.nameInput}
            placeholder="Collection name..."
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateSubmit()
              if (e.key === 'Escape') setCreatingParentId(null)
            }}
            autoFocus
          />
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={() => void handleCreateSubmit()}
          >
            Add
          </button>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => setCreatingParentId(null)}
          >
            ✕
          </button>
        </div>
      )}

      {loadError && (
        <div className={styles.actionError} role="alert">
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className={styles.emptyTree}>Loading collections...</div>
      ) : tree.length === 0 && creatingParentId !== 'root' ? (
        // A failed load is not an empty library; the load error above explains it.
        loadError ? null : (
          <div className={styles.emptyTree}>No collections yet. Click + to add one.</div>
        )
      ) : (
        <div className={styles.tree}>{renderTreeNodes(tree)}</div>
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
