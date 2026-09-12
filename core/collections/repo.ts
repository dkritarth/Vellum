// Collections repo — [L2-01] Hierarchical collections and Library filtering.
// Backed by SQLite `collections` and `paper_collections` tables (SCHEMA_V1).
import type { Database } from 'better-sqlite3'

export interface CollectionRecord {
  id: number
  name: string
  parentId: number | null
}

export interface CollectionTreeItem extends CollectionRecord {
  children: CollectionTreeItem[]
  paperCount: number
}

interface CollectionRow {
  id: number
  name: string
  parent_id: number | null
}

/** Check if adding `parentId` under `id` would create a cycle or refer to nonexistent parent. */
function validateParent(db: Database, id: number | null, parentId: number | null): void {
  if (parentId === null) return
  if (id !== null && id === parentId) {
    throw new Error('A collection cannot be its own parent')
  }

  // Ensure parent exists
  const parent = db.prepare('SELECT id, parent_id FROM collections WHERE id = ?').get(parentId) as CollectionRow | undefined
  if (!parent) {
    throw new Error(`Parent collection ${parentId} does not exist`)
  }

  if (id === null) return

  // Walk up ancestor chain from parent to ensure `id` is not encountered (cycle check)
  let currentParentId: number | null = parent.parent_id
  while (currentParentId !== null) {
    if (currentParentId === id) {
      throw new Error(`Cycle detected: collection ${parentId} is a descendant of ${id}`)
    }
    const ancestor = db.prepare('SELECT parent_id FROM collections WHERE id = ?').get(currentParentId) as CollectionRow | undefined
    currentParentId = ancestor?.parent_id ?? null
  }
}

/** Create a new collection. */
export function createCollection(
  db: Database,
  params: { name: string; parentId?: number | null },
): CollectionRecord {
  const name = params.name.trim()
  if (!name) {
    throw new Error('Collection name cannot be empty')
  }
  const parentId = params.parentId ?? null
  validateParent(db, null, parentId)

  const stmt = db.prepare('INSERT INTO collections (name, parent_id) VALUES (?, ?)')
  const result = stmt.run(name, parentId)
  return {
    id: Number(result.lastInsertRowid),
    name,
    parentId,
  }
}

/** Rename an existing collection. */
export function renameCollection(db: Database, id: number, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Collection name cannot be empty')
  }
  const result = db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(trimmed, id)
  if (result.changes === 0) {
    throw new Error(`Collection ${id} not found`)
  }
}

/** Move / re-parent an existing collection. */
export function moveCollection(db: Database, id: number, parentId: number | null): void {
  validateParent(db, id, parentId)
  const result = db.prepare('UPDATE collections SET parent_id = ? WHERE id = ?').run(parentId, id)
  if (result.changes === 0) {
    throw new Error(`Collection ${id} not found`)
  }
}

/**
 * Delete a collection and all its descendants recursively.
 * Papers in the collections are NOT deleted — only their collection mappings in `paper_collections` are removed (CASCADE).
 */
export function deleteCollection(db: Database, id: number): void {
  // Find all descendant IDs recursively
  const findDescendants = db.transaction((rootId: number) => {
    const toDelete: number[] = [rootId]
    const queue: number[] = [rootId]

    while (queue.length > 0) {
      const current = queue.shift()!
      const rows = db.prepare('SELECT id FROM collections WHERE parent_id = ?').all(current) as { id: number }[]
      for (const row of rows) {
        toDelete.push(row.id)
        queue.push(row.id)
      }
    }

    // Delete in reverse order (children first) to satisfy foreign keys
    toDelete.reverse()
    for (const collId of toDelete) {
      db.prepare('DELETE FROM paper_collections WHERE collection_id = ?').run(collId)
      db.prepare('DELETE FROM collections WHERE id = ?').run(collId)
    }
  })

  findDescendants(id)
}

/** Fetch all collections as a flat list. */
export function listCollections(db: Database): CollectionRecord[] {
  const rows = db.prepare('SELECT id, name, parent_id FROM collections ORDER BY name COLLATE NOCASE ASC').all() as CollectionRow[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
  }))
}

/** Fetch all collections structured as a tree with paper counts. */
export function getCollectionsTree(db: Database): CollectionTreeItem[] {
  const collections = listCollections(db)
  const countsRows = db.prepare(`
    SELECT collection_id, COUNT(paper_slug) as count
    FROM paper_collections
    GROUP BY collection_id
  `).all() as { collection_id: number; count: number }[]

  const countMap = new Map<number, number>()
  for (const row of countsRows) {
    countMap.set(row.collection_id, row.count)
  }

  const map = new Map<number, CollectionTreeItem>()
  for (const c of collections) {
    map.set(c.id, {
      ...c,
      children: [],
      paperCount: countMap.get(c.id) ?? 0,
    })
  }

  const roots: CollectionTreeItem[] = []
  for (const c of collections) {
    const item = map.get(c.id)!
    if (c.parentId === null || !map.has(c.parentId)) {
      roots.push(item)
    } else {
      map.get(c.parentId)!.children.push(item)
    }
  }

  return roots
}

/** Assign a paper to a collection. Idempotent (does not duplicate). */
export function assignPaperToCollection(
  db: Database,
  params: { paperSlug: string; collectionId: number },
): void {
  // Verify collection exists
  const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(params.collectionId)
  if (!coll) {
    throw new Error(`Collection ${params.collectionId} does not exist`)
  }
  // Verify paper exists
  const paper = db.prepare('SELECT slug FROM papers WHERE slug = ?').get(params.paperSlug)
  if (!paper) {
    throw new Error(`Paper ${params.paperSlug} does not exist`)
  }

  db.prepare(`
    INSERT INTO paper_collections (paper_slug, collection_id)
    VALUES (?, ?)
    ON CONFLICT (paper_slug, collection_id) DO NOTHING
  `).run(params.paperSlug, params.collectionId)
}

/** Remove a paper from a collection. */
export function removePaperFromCollection(
  db: Database,
  params: { paperSlug: string; collectionId: number },
): void {
  db.prepare(`
    DELETE FROM paper_collections
    WHERE paper_slug = ? AND collection_id = ?
  `).run(params.paperSlug, params.collectionId)
}

/** List all collections that a paper belongs to. */
export function listPaperCollections(db: Database, paperSlug: string): CollectionRecord[] {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.parent_id
    FROM collections c
    JOIN paper_collections pc ON pc.collection_id = c.id
    WHERE pc.paper_slug = ?
    ORDER BY c.name COLLATE NOCASE ASC
  `).all(paperSlug) as CollectionRow[]

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
  }))
}
