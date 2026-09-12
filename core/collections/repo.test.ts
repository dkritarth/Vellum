import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openDb } from '../store/db.js'
import {
  assignPaperToCollection,
  createCollection,
  deleteCollection,
  getCollectionsTree,
  listCollections,
  listPaperCollections,
  moveCollection,
  removePaperFromCollection,
  renameCollection,
} from './repo.js'
import { upsertPaper } from '../library/repo.js'

describe('collections repo [L2-01]', () => {
  let db: Database

  beforeEach(() => {
    db = openDb({ path: ':memory:' })
    // Seed test papers
    upsertPaper(db, {
      slug: 'paper-1',
      title: 'Attention Is All You Need',
      authors: ['Vaswani et al.'],
      addedAt: '2026-01-01T00:00:00Z',
    })
    upsertPaper(db, {
      slug: 'paper-2',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers',
      authors: ['Devlin et al.'],
      addedAt: '2026-01-02T00:00:00Z',
    })
  })

  it('creates, lists, and renames collections', () => {
    const c1 = createCollection(db, { name: 'Machine Learning' })
    expect(c1.id).toBeGreaterThan(0)
    expect(c1.name).toBe('Machine Learning')
    expect(c1.parentId).toBeNull()

    const c2 = createCollection(db, { name: 'NLP', parentId: c1.id })
    expect(c2.parentId).toBe(c1.id)

    const list = listCollections(db)
    expect(list).toHaveLength(2)
    expect(list.find((c) => c.id === c1.id)?.name).toBe('Machine Learning')
    expect(list.find((c) => c.id === c2.id)?.name).toBe('NLP')

    renameCollection(db, c2.id, 'Natural Language Processing')
    const updated = listCollections(db)
    expect(updated.find((c) => c.id === c2.id)?.name).toBe('Natural Language Processing')
  })

  it('rejects empty names and non-existent parents', () => {
    expect(() => createCollection(db, { name: '   ' })).toThrow(/name cannot be empty/)
    expect(() => createCollection(db, { name: 'Child', parentId: 999 })).toThrow(/does not exist/)
  })

  it('rejects cycles and self-parenting when moving collections', () => {
    const c1 = createCollection(db, { name: 'Level 1' })
    const c2 = createCollection(db, { name: 'Level 2', parentId: c1.id })
    const c3 = createCollection(db, { name: 'Level 3', parentId: c2.id })

    // Self-parenting
    expect(() => moveCollection(db, c1.id, c1.id)).toThrow(/cannot be its own parent/)
    // Cycle: making Level 1 a child of Level 3
    expect(() => moveCollection(db, c1.id, c3.id)).toThrow(/Cycle detected/)
  })

  it('assigns, lists, and removes papers without duplication', () => {
    const c1 = createCollection(db, { name: 'Transformers' })
    assignPaperToCollection(db, { paperSlug: 'paper-1', collectionId: c1.id })
    // Re-assigning same paper is idempotent
    assignPaperToCollection(db, { paperSlug: 'paper-1', collectionId: c1.id })

    const p1Colls = listPaperCollections(db, 'paper-1')
    expect(p1Colls).toHaveLength(1)
    expect(p1Colls[0].name).toBe('Transformers')

    removePaperFromCollection(db, { paperSlug: 'paper-1', collectionId: c1.id })
    expect(listPaperCollections(db, 'paper-1')).toHaveLength(0)
  })

  it('builds a hierarchical tree with paper counts', () => {
    const c1 = createCollection(db, { name: 'AI' })
    const c2 = createCollection(db, { name: 'NLP', parentId: c1.id })
    createCollection(db, { name: 'Vision', parentId: c1.id })

    assignPaperToCollection(db, { paperSlug: 'paper-1', collectionId: c2.id })
    assignPaperToCollection(db, { paperSlug: 'paper-2', collectionId: c2.id })

    const tree = getCollectionsTree(db)
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('AI')
    expect(tree[0].children).toHaveLength(2)

    const nlpNode = tree[0].children.find((c) => c.name === 'NLP')!
    expect(nlpNode.paperCount).toBe(2)
  })

  it('deletes collection recursively without deleting actual papers', () => {
    const parent = createCollection(db, { name: 'Parent' })
    const child = createCollection(db, { name: 'Child', parentId: parent.id })

    assignPaperToCollection(db, { paperSlug: 'paper-1', collectionId: child.id })
    assignPaperToCollection(db, { paperSlug: 'paper-2', collectionId: parent.id })

    deleteCollection(db, parent.id)

    expect(listCollections(db)).toHaveLength(0)
    expect(listPaperCollections(db, 'paper-1')).toHaveLength(0)
    expect(listPaperCollections(db, 'paper-2')).toHaveLength(0)

    // Verify paper rows remain intact
    const row = db.prepare('SELECT slug FROM papers WHERE slug = ?').get('paper-1')
    expect(row).toBeDefined()
  })
})
