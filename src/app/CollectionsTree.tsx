import { useEffect, useState } from 'react'
import type { CollectionTreeItem } from '../../electron/preload'
import styles from './CollectionsTree.module.css'

export interface CollectionsTreeProps {
  selectedCollectionId: number | null
  onSelectCollection: (id: number | null, name: string | null) => void
}

export function CollectionsTree({
  selectedCollectionId,
  onSelectCollection,
}: CollectionsTreeProps): JSX.Element {
  const [tree, setTree] = useState<CollectionTreeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingParentId, setCreatingParentId] = useState<number | null | 'root'>(null)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  async function refreshTree(): Promise<void> {
    try {
      if (window.vellum?.collectionsTree) {
        const data = await window.vellum.collectionsTree()
        setTree(data)
      }
    } catch {
      // Fallback or quiet on error
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshTree()
    const interval = setInterval(refreshTree, 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleCreateSubmit(): Promise<void> {
    const name = newCollectionName.trim()
    if (!name) return

    const parentId = creatingParentId === 'root' ? null : creatingParentId
    try {
      const created = await window.vellum.collectionsCreate({ name, parentId })
      setNewCollectionName('')
      setCreatingParentId(null)
      await refreshTree()
      onSelectCollection(created.id, created.name)
    } catch (err) {
      console.error('Failed to create collection', err)
    }
  }

  async function handleRenameSubmit(id: number): Promise<void> {
    const name = editingName.trim()
    if (!name) return

    try {
      await window.vellum.collectionsRename({ id, name })
      setEditingId(null)
      setEditingName('')
      await refreshTree()
      if (selectedCollectionId === id) {
        onSelectCollection(id, name)
      }
    } catch (err) {
      console.error('Failed to rename collection', err)
    }
  }

  async function handleDelete(id: number, name: string): Promise<void> {
    if (!window.confirm(`Delete collection "${name}" and all subcollections? Papers will not be deleted.`)) {
      return
    }

    try {
      await window.vellum.collectionsDelete(id)
      if (selectedCollectionId === id) {
        onSelectCollection(null, null)
      }
      await refreshTree()
    } catch (err) {
      console.error('Failed to delete collection', err)
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
              className={`${styles.treeItem} ${isSelected ? styles.treeItemActive : ''}`}
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
              onClick={() => onSelectCollection(node.id, node.name)}
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

      <div
        className={`${styles.allPapersItem} ${selectedCollectionId === null ? styles.allPapersActive : ''}`}
        onClick={() => onSelectCollection(null, null)}
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

      {loading ? (
        <div className={styles.emptyTree}>Loading collections...</div>
      ) : tree.length === 0 && creatingParentId !== 'root' ? (
        <div className={styles.emptyTree}>No collections yet. Click + to add one.</div>
      ) : (
        <div className={styles.tree}>{renderTreeNodes(tree)}</div>
      )}
    </div>
  )
}
