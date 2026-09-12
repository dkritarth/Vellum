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
})
