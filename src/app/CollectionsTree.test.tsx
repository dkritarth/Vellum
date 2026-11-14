// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionsTree } from './CollectionsTree'
import { openDb } from '../../core/store/db'
import { createCollection, deleteCollection, getCollectionsTree, listCollections } from '../../core/collections/repo'

describe('CollectionsTree [L2-01]', () => {
  const mockTree = [
    {
      id: 1,
      name: 'Computer Science',
      parentId: null,
      paperCount: 3,
      children: [
        {
          id: 2,
          name: 'AI',
          parentId: 1,
          paperCount: 2,
          children: [],
        },
      ],
    },
  ]

  beforeEach(() => {
    window.vellum = {
      ...window.vellum,
      collectionsTree: vi.fn().mockResolvedValue(mockTree),
      collectionsCreate: vi.fn().mockResolvedValue({ id: 3, name: 'Databases', parentId: null }),
      collectionsRename: vi.fn().mockResolvedValue(undefined),
      collectionsDelete: vi.fn().mockResolvedValue(undefined),
    } as any
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders collections tree with paper count badges', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={onSelect} />)

    expect(await screen.findByText('Computer Science')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('All Papers')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('triggers onSelectCollection when an item is clicked', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={onSelect} />)

    const aiNode = await screen.findByRole('treeitem', { name: /AI/i })
    fireEvent.click(aiNode)
    expect(onSelect).toHaveBeenCalledWith(2, 'AI')

    const allPapers = screen.getByRole('treeitem', { name: /All Papers/i })
    fireEvent.click(allPapers)
    expect(onSelect).toHaveBeenCalledWith(null, null)
  })

  it('creates a new root collection', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={onSelect} />)

    await screen.findByText('Computer Science')
    const addBtn = screen.getByRole('button', { name: 'New Collection' })
    fireEvent.click(addBtn)

    const input = screen.getByPlaceholderText('Collection name...')
    fireEvent.change(input, { target: { value: 'Databases' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(window.vellum.collectionsCreate).toHaveBeenCalledWith({
        name: 'Databases',
        parentId: null,
      })
      expect(onSelect).toHaveBeenCalledWith(3, 'Databases')
    })
  })

  it('renames an existing collection', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={1} onSelectCollection={onSelect} />)

    await screen.findByText('Computer Science')
    const renameBtn = screen.getByRole('button', { name: 'Rename Computer Science' })
    fireEvent.click(renameBtn)

    const editInput = screen.getByDisplayValue('Computer Science')
    fireEvent.change(editInput, { target: { value: 'Informatics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(window.vellum.collectionsRename).toHaveBeenCalledWith({
        id: 1,
        name: 'Informatics',
      })
    })
  })

  it('deletes a collection and clears selection if active', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={2} onSelectCollection={onSelect} />)

    await screen.findByText('AI')
    const deleteBtn = screen.getByRole('button', { name: 'Delete AI' })
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled()
      expect(window.vellum.collectionsDelete).toHaveBeenCalledWith(2)
      expect(onSelect).toHaveBeenCalledWith(null, null)
    })
  })

  it('shows a visible error and keeps the input when creating fails', async () => {
    window.vellum.collectionsCreate = vi.fn().mockRejectedValue(new Error('parent not found')) as any
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={onSelect} />)
    await screen.findByText('Computer Science')

    fireEvent.click(screen.getByRole('button', { name: 'New Collection' }))
    fireEvent.change(screen.getByPlaceholderText('Collection name...'), { target: { value: 'Databases' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not create collection/i)
    expect(alert).toHaveTextContent(/parent not found/)
    expect(screen.getByDisplayValue('Databases')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows a visible error when renaming fails', async () => {
    window.vellum.collectionsRename = vi.fn().mockRejectedValue(new Error('Collection 1 not found')) as any
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)
    await screen.findByText('Computer Science')

    fireEvent.click(screen.getByRole('button', { name: 'Rename Computer Science' }))
    fireEvent.change(screen.getByDisplayValue('Computer Science'), { target: { value: 'Informatics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not rename collection/i)
    expect(alert).toHaveTextContent(/Collection 1 not found/)
  })

  it('shows one persistent load error while polling fails and clears it on the next successful load', async () => {
    window.vellum.collectionsTree = vi
      .fn()
      .mockRejectedValueOnce(new Error("Error invoking remote method 'collections:tree': Error: database is locked"))
      .mockRejectedValueOnce(new Error("Error invoking remote method 'collections:tree': Error: database is locked"))
      .mockResolvedValue(mockTree) as any
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load collections/i)
    expect(alert).toHaveTextContent('database is locked')
    expect(alert).not.toHaveTextContent('Error invoking remote method')
    // A failed load must not masquerade as an empty library.
    expect(screen.queryByText(/no collections yet/i)).not.toBeInTheDocument()

    // Second failing poll: still exactly one message, same DOM node (no re-mounted banner).
    await waitFor(() => expect(window.vellum.collectionsTree).toHaveBeenCalledTimes(2), { timeout: 2500 })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toBe(alert)

    // Next successful poll clears the message and shows the tree.
    expect(await screen.findByText('Computer Science', {}, { timeout: 2500 })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a visible error and keeps selection when deleting fails, then clears it on success', async () => {
    window.vellum.collectionsDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk I/O error'))
      .mockResolvedValue(undefined) as any
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={2} onSelectCollection={onSelect} />)
    await screen.findByText('AI')

    fireEvent.click(screen.getByRole('button', { name: 'Delete AI' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not delete collection "AI"/i)
    expect(alert).toHaveTextContent(/disk I\/O error/)
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete AI' }))
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(null, null)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('reports collection changes so the Library can offer new collections on cards', async () => {
    const onCollectionsChanged = vi.fn()
    window.vellum = {
      ...window.vellum,
      collectionsRename: vi.fn().mockResolvedValue(undefined),
      collectionsDelete: vi.fn().mockResolvedValue(undefined),
    } as any
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} onCollectionsChanged={onCollectionsChanged} />,
    )
    await screen.findByText('Computer Science')

    fireEvent.click(screen.getByRole('button', { name: 'New Collection' }))
    fireEvent.change(screen.getByPlaceholderText('Collection name...'), { target: { value: 'Databases' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onCollectionsChanged).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Rename AI' }))
    const rename = screen.getByDisplayValue('AI')
    fireEvent.change(rename, { target: { value: 'ML' } })
    fireEvent.keyDown(rename, { key: 'Enter' })
    await waitFor(() => expect(onCollectionsChanged).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Computer Science' }))
    await waitFor(() => expect(onCollectionsChanged).toHaveBeenCalledTimes(3))
  })

  it('assigns a paper dropped on a collection and reports it', async () => {
    const collectionsAssign = vi.fn().mockResolvedValue(undefined)
    window.vellum = { ...window.vellum, collectionsAssign } as any
    const onPaperAssigned = vi.fn()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} onPaperAssigned={onPaperAssigned} />)

    const row = (await screen.findByText('AI')).closest('[role="treeitem"]') as HTMLElement
    const dataTransfer = {
      types: ['application/x-vellum-paper'],
      getData: (type: string) => (type === 'application/x-vellum-paper' ? 'arxiv-1706.03762' : ''),
      dropEffect: '',
    }
    fireEvent.dragOver(row, { dataTransfer })
    expect(row.className).toMatch(/dropTarget/)
    fireEvent.drop(row, { dataTransfer })

    await waitFor(() => {
      expect(collectionsAssign).toHaveBeenCalledWith({ paperSlug: 'arxiv-1706.03762', collectionId: 2 })
      expect(onPaperAssigned).toHaveBeenCalledWith(2)
    })
  })

  it('ignores drags that do not carry a paper', async () => {
    const collectionsAssign = vi.fn()
    window.vellum = { ...window.vellum, collectionsAssign } as any
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)

    const row = (await screen.findByText('AI')).closest('[role="treeitem"]') as HTMLElement
    const dataTransfer = { types: ['text/plain'], getData: () => 'hello', dropEffect: '' }
    fireEvent.dragOver(row, { dataTransfer })
    fireEvent.drop(row, { dataTransfer })
    expect(row.className).not.toMatch(/dropTarget/)
    expect(collectionsAssign).not.toHaveBeenCalled()
  })

  it('lets keyboard users focus and select collection rows with Enter or Space', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={2} onSelectCollection={onSelect} />)

    const row = (await screen.findByText('Computer Science')).closest('[role="treeitem"]') as HTMLElement
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(1, 'Computer Science')

    const allPapers = screen.getByText('All Papers').closest('[role="treeitem"]') as HTMLElement
    expect(allPapers).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(allPapers, { key: ' ' })
    expect(onSelect).toHaveBeenLastCalledWith(null, null)
  })

  it('does not select a row when Enter is pressed on one of its action buttons', async () => {
    const onSelect = vi.fn()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={onSelect} />)

    const rename = await screen.findByRole('button', { name: 'Rename AI' })
    fireEvent.keyDown(rename, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('CollectionsTree refresh ownership', () => {
  const created = { id: 3, name: 'New research', parentId: null, paperCount: 0, children: [] }
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

  for (const outcome of ['success', 'error']) {
    it(`keeps created collection and selection after obsolete initial ${outcome}`, async () => {
      const old = deferred<typeof created[]>()
      window.vellum = {
        ...window.vellum,
        collectionsTree: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([created]),
        collectionsCreate: vi.fn().mockResolvedValue(created),
      }
      const onSelect = vi.fn()
      render(<CollectionsTree selectedCollectionId={null} onSelectCollection={onSelect} />)
      fireEvent.click(screen.getByRole('button', { name: 'New Collection' }))
      fireEvent.change(screen.getByPlaceholderText('Collection name...'), { target: { value: created.name } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
      await act(async () => {})
      expect(screen.getByText(created.name)).toBeVisible()
      expect(onSelect).toHaveBeenCalledWith(created.id, created.name)
      await act(async () => {
        if (outcome === 'success') old.resolve([])
        else old.reject(new Error('Obsolete failure'))
      })
      expect(screen.getByText(created.name)).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  }

  it('keeps loading until the latest overlapping poll settles, preserves its error, then recovers', async () => {
    vi.useFakeTimers()
    const initial = deferred<typeof created[]>()
    const current = deferred<typeof created[]>()
    window.vellum.collectionsTree = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(current.promise)
      .mockResolvedValue([created])
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)
    await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => { initial.resolve([]) })
    expect(screen.getByText('Loading collections...')).toBeVisible()
    expect(screen.queryByText(/No collections yet/)).not.toBeInTheDocument()
    await act(async () => { current.reject(new Error('Current failure')) })
    expect(screen.getByRole('alert')).toHaveTextContent('Current failure')
    expect(screen.queryByText('Loading collections...')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText(created.name)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not let an obsolete successful poll dismiss a current failure', async () => {
    vi.useFakeTimers()
    const old = deferred<typeof created[]>()
    window.vellum.collectionsTree = vi.fn()
      .mockResolvedValueOnce([created])
      .mockReturnValueOnce(old.promise)
      .mockRejectedValue(new Error('Latest failure'))
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('alert')).toHaveTextContent('Latest failure')
    await act(async () => { old.resolve([]) })
    expect(screen.getByRole('alert')).toHaveTextContent('Latest failure')
    expect(screen.getByText(created.name)).toBeVisible()
  })

  for (const mutation of ['rename', 'delete']) {
    it(`ignores an obsolete ${mutation} refresh after a newer poll`, async () => {
      vi.useFakeTimers()
      const old = deferred<typeof created[]>()
      const renamed = { ...created, name: 'Renamed research' }
      const latest = mutation === 'rename' ? [renamed] : []
      window.vellum.collectionsTree = vi.fn().mockResolvedValueOnce([created])
        .mockReturnValueOnce(old.promise).mockResolvedValue(latest)
      window.vellum.collectionsRename = vi.fn().mockResolvedValue(undefined)
      window.vellum.collectionsDelete = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const onSelect = vi.fn()
      render(<CollectionsTree selectedCollectionId={created.id} onSelectCollection={onSelect} />)
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: `${mutation === 'rename' ? 'Rename' : 'Delete'} ${created.name}` }))
      if (mutation === 'rename') {
        fireEvent.change(screen.getByDisplayValue(created.name), { target: { value: renamed.name } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      }
      await act(async () => {})
      await act(async () => { vi.advanceTimersByTime(1000) })
      await act(async () => { old.resolve([created]) })
      expect(screen.queryByText(created.name)).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(onSelect).toHaveBeenCalledWith(...(mutation === 'rename' ? [created.id, renamed.name] : [null, null]))
      if (mutation === 'rename') expect(screen.getByText(renamed.name)).toBeVisible()
      else expect(screen.getByText(/No collections yet/)).toBeVisible()
    })
  }

  it('retires requests across effect cleanup and remount', async () => {
    vi.useFakeTimers()
    const old = deferred<typeof created[]>()
    const list = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([created])
    window.vellum.collectionsTree = list
    const first = render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)
    first.unmount()
    render(<CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} />)
    await act(async () => { old.reject(new Error('Unmounted failure')) })
    expect(screen.getByText(created.name)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(list).toHaveBeenCalledTimes(3)
  })

  it('retires the first StrictMode effect request when its effect restarts', async () => {
    const old = deferred<typeof created[]>()
    window.vellum.collectionsTree = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([created])
    render(<StrictMode><CollectionsTree selectedCollectionId={null} onSelectCollection={vi.fn()} /></StrictMode>)
    await act(async () => {})
    expect(screen.getByText(created.name)).toBeVisible()
    await act(async () => { old.resolve([]) })
    expect(screen.getByText(created.name)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('recursive deletion selection', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  async function setup(initial: 'parent' | 'child' | 'deep' | 'unrelated' = 'child') {
    const db = openDb({ path: ':memory:' })
    const parent = createCollection(db, { name: 'Parent research' })
    const child = createCollection(db, { name: 'Child research', parentId: parent.id })
    const deep = createCollection(db, { name: 'Deep research', parentId: child.id })
    const unrelated = createCollection(db, { name: 'Other research' })
    const collections = { parent, child, deep, unrelated }
    const onSelect = vi.fn()
    window.vellum = {
      ...window.vellum,
      collectionsTree: vi.fn(async () => getCollectionsTree(db)),
      collectionsDelete: vi.fn(async (id: number) => deleteCollection(db, id)),
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    function View() {
      const [selected, setSelected] = useState<number | null>(collections[initial].id)
      return <>
        <p data-testid="filter">{selected === null ? 'All Papers' : `Filtered collection ${selected}`}</p>
        <CollectionsTree selectedCollectionId={selected} onSelectCollection={(id, name) => {
          onSelect(id, name)
          setSelected(id)
        }} />
      </>
    }
    render(<View />)
    await screen.findByText('Deep research')
    return { db, collections, onSelect }
  }

  it.each(['child', 'deep', 'parent'] as const)('clears selected %s after real recursive parent deletion', async initial => {
    const { db, onSelect } = await setup(initial)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Parent research' }))
      await waitFor(() => expect(screen.queryByText('Parent research')).not.toBeInTheDocument())
      expect(listCollections(db).map(collection => collection.name)).toEqual(['Other research'])
      expect(screen.getByTestId('filter')).toHaveTextContent('All Papers')
      expect(onSelect).toHaveBeenCalledWith(null, null)
    } finally { db.close() }
  })

  it('preserves unrelated selection after recursive deletion', async () => {
    const { db, collections, onSelect } = await setup('unrelated')
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Parent research' }))
      await waitFor(() => expect(screen.queryByText('Parent research')).not.toBeInTheDocument())
      expect(screen.getByTestId('filter')).toHaveTextContent(`Filtered collection ${collections.unrelated.id}`)
      expect(onSelect).not.toHaveBeenCalled()
    } finally { db.close() }
  })

  it.each([
    ['parent', 'Other research', false],
    ['unrelated', 'Deep research', true],
    ['child', 'All Papers', false],
  ] as const)('reconciles latest selection: %s switches to %s while deletion is pending', async (initial, next, clears) => {
    const { db, collections, onSelect } = await setup(initial)
    try {
      const pending = deferred<void>()
      window.vellum.collectionsDelete = vi.fn(async (id: number) => {
        await pending.promise
        deleteCollection(db, id)
      })
      fireEvent.click(screen.getByRole('button', { name: 'Delete Parent research' }))
      fireEvent.click(screen.getByRole('treeitem', { name: new RegExp(next) }))
      onSelect.mockClear()
      expect(listCollections(db)).toHaveLength(4)
      await act(async () => pending.resolve())
      expect(screen.getByTestId('filter')).toHaveTextContent(
        clears || next === 'All Papers' ? 'All Papers' : `Filtered collection ${collections.unrelated.id}`,
      )
      if (clears) expect(onSelect).toHaveBeenCalledWith(null, null)
      else expect(onSelect).not.toHaveBeenCalled()
      expect(screen.queryByText('Parent research')).not.toBeInTheDocument()
    } finally { db.close() }
  })

  it('retains descendant filter and tree on failure, then clears after retry succeeds', async () => {
    const { db, collections, onSelect } = await setup('deep')
    try {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      window.vellum.collectionsDelete = vi.fn().mockRejectedValueOnce(new Error('disk I/O error'))
        .mockImplementation(async (id: number) => deleteCollection(db, id))
      fireEvent.click(screen.getByRole('button', { name: 'Delete Parent research' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete collection "Parent research": disk I/O error')
      expect(screen.getByTestId('filter')).toHaveTextContent(`Filtered collection ${collections.deep.id}`)
      expect(listCollections(db)).toHaveLength(4)
      expect(onSelect).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Delete Parent research' }))
      await waitFor(() => expect(screen.getByTestId('filter')).toHaveTextContent('All Papers'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally { db.close() }
  })

  it('retains descendant filter and tree when confirmation is cancelled', async () => {
    const { db, collections, onSelect } = await setup()
    try {
      vi.mocked(window.confirm).mockReturnValue(false)
      fireEvent.click(screen.getByRole('button', { name: 'Delete Parent research' }))
      expect(window.vellum.collectionsDelete).not.toHaveBeenCalled()
      expect(listCollections(db)).toHaveLength(4)
      expect(screen.getByTestId('filter')).toHaveTextContent(`Filtered collection ${collections.child.id}`)
      expect(onSelect).not.toHaveBeenCalled()
    } finally { db.close() }
  })
})
