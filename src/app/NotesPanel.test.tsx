// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesPanel } from './NotesPanel'

let notesGet: ReturnType<typeof vi.fn>
let notesSave: ReturnType<typeof vi.fn>
let notesDelete: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  notesGet = vi.fn().mockResolvedValue(null)
  notesSave = vi.fn().mockResolvedValue({ paperSlug: 'p1', body: '', updatedAt: 't' })
  notesDelete = vi.fn().mockResolvedValue(undefined)

  Object.defineProperty(window, 'vellum', {
    configurable: true,
    value: { notesGet, notesSave, notesDelete },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('NotesPanel', () => {
  it('shows a placeholder when no paper is open', () => {
    render(<NotesPanel />)
    expect(screen.getByText(/open a paper/i)).toBeInTheDocument()
    expect(notesGet).not.toHaveBeenCalled()
  })

  it('loads and displays an existing note for the open paper', async () => {
    notesGet.mockResolvedValue({ paperSlug: 'p1', body: 'existing note text', updatedAt: 't' })

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    expect(screen.getByDisplayValue('existing note text')).toBeInTheDocument()
    expect(notesGet).toHaveBeenCalledWith('p1')
  })

  it('shows an empty editor when no note exists yet', async () => {
    notesGet.mockResolvedValue(null)

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    const textarea = screen.getByRole('textbox', { name: /note/i }) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('autosaves edits after a debounce, keyed to the open paper', async () => {
    notesGet.mockResolvedValue({ paperSlug: 'p1', body: '', updatedAt: 't' })

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    const textarea = screen.getByRole('textbox', { name: /note/i })
    fireEvent.change(textarea, { target: { value: 'new note body' } })

    // Not saved immediately — waits out the debounce window.
    expect(notesSave).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'new note body' })
  })

  it('does not save if the editor is untouched', async () => {
    notesGet.mockResolvedValue({ paperSlug: 'p1', body: 'unchanged', updatedAt: 't' })

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(notesSave).not.toHaveBeenCalled()
  })

  it('flushes a pending debounced save for the outgoing paper when switching before it fires', async () => {
    notesGet.mockResolvedValue({ paperSlug: 'p1', body: '', updatedAt: 't' })

    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()

    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'edited before switch' },
    })
    // Not saved yet — still inside the debounce window.
    expect(notesSave).not.toHaveBeenCalled()

    notesGet.mockResolvedValue(null)
    await act(async () => {
      rerender(<NotesPanel slug="p2" />)
    })
    await flushPromises()

    // Flushed immediately for the OUTGOING slug ('p1'), not discarded and
    // not attributed to the newly-opened paper.
    expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'edited before switch' })
    expect(notesGet).toHaveBeenCalledWith('p2')
  })

  it('flushes a pending debounced save on unmount before it fires', async () => {
    notesGet.mockResolvedValue({ paperSlug: 'p1', body: '', updatedAt: 't' })

    const { unmount } = render(<NotesPanel slug="p1" />)
    await flushPromises()

    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'edited before unmount' },
    })
    expect(notesSave).not.toHaveBeenCalled()

    unmount()

    expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'edited before unmount' })
  })

  it('clears the note via the Clear note action', async () => {
    notesGet.mockResolvedValue({ paperSlug: 'p1', body: 'existing note text', updatedAt: 't' })

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
    await flushPromises()

    expect(notesDelete).toHaveBeenCalledWith('p1')
    const textarea = screen.getByRole('textbox', { name: /note/i }) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('disables the Clear note action when there is nothing to clear', async () => {
    notesGet.mockResolvedValue(null)

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    expect(screen.getByRole('button', { name: /clear note/i })).toBeDisabled()
  })
})
