// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionsTree } from './CollectionsTree'

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
})
