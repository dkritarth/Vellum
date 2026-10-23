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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

  it.each(['resolve', 'reject', 'resolve after autosave'] as const)(
    'preserves typing during a delayed load (%s) and saves it when switching papers', async (outcome) => {
      let resolveRead!: (note: { body: string }) => void
      let rejectRead!: (error: Error) => void
      notesGet.mockReturnValueOnce(new Promise((resolve, reject) => {
        resolveRead = resolve
        rejectRead = reject
      }))
      const { rerender } = render(<NotesPanel slug="p1" />)

      fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
        target: { value: 'typed while loading' },
      })
      if (outcome === 'resolve after autosave') {
        await act(async () => { vi.advanceTimersByTime(500) })
      }
      await act(async () => {
        if (outcome === 'reject') rejectRead(new Error('read failed'))
        else resolveRead({ body: 'old persisted note' })
      })

      expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('typed while loading')
      if (outcome !== 'resolve after autosave') expect(notesSave).not.toHaveBeenCalled()

      rerender(<NotesPanel slug="p2" />)
      await flushPromises()
      expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('')
      expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'typed while loading' })
    },
  )

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

  it('ignores a Clear rejection from an outgoing paper without saving its text under the next paper', async () => {
    const deletion = deferred<void>()
    notesDelete.mockReturnValueOnce(deletion.promise)
    notesGet.mockResolvedValueOnce({ body: 'A original' }).mockResolvedValueOnce({ body: 'B original' })
    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()

    fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'B edited' },
    })
    await act(async () => { deletion.reject(new Error('delete failed')) })

    expect.soft(screen.getByRole('textbox', { name: /note/i })).toHaveValue('B edited')
    rerender(<NotesPanel slug="p3" />)
    await flushPromises()
    expect(notesSave).toHaveBeenCalledTimes(1)
    expect(notesSave).toHaveBeenCalledWith({ slug: 'p2', body: 'B edited' })
  })

  it.each(['resolve', 'reject'] as const)(
    'preserves a newer saved edit when an earlier Clear finishes (%s)', async (outcome) => {
      const deletion = deferred<void>()
      notesDelete.mockReturnValueOnce(deletion.promise)
      notesGet.mockResolvedValueOnce({ body: 'original' })
      const { rerender } = render(<NotesPanel slug="p1" />)
      await flushPromises()

      fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
      fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
        target: { value: 'newer edit' },
      })
      await act(async () => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('Saved')).toBeInTheDocument()
      await act(async () => {
        if (outcome === 'resolve') deletion.resolve()
        else deletion.reject(new Error('delete failed'))
      })

      expect.soft(screen.getByRole('textbox', { name: /note/i })).toHaveValue('newer edit')
      expect.soft(screen.getByText('Saved')).toBeInTheDocument()
      rerender(<NotesPanel slug="p2" />)
      await flushPromises()
      expect(notesSave).toHaveBeenCalledTimes(1)
      expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'newer edit' })
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'keeps a newer save pending when an earlier autosave finishes (%s)', async (outcome) => {
      const olderSave = deferred<void>()
      const newerSave = deferred<void>()
      notesSave.mockReturnValueOnce(olderSave.promise).mockReturnValueOnce(newerSave.promise)
      render(<NotesPanel slug="p1" />)
      await flushPromises()
      const editor = screen.getByRole('textbox', { name: /note/i })

      fireEvent.change(editor, { target: { value: 'older edit' } })
      await act(async () => { vi.advanceTimersByTime(500) })
      fireEvent.change(editor, { target: { value: 'newer edit' } })
      await act(async () => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('Saving…')).toBeInTheDocument()
      await act(async () => {
        if (outcome === 'resolve') olderSave.resolve()
        else olderSave.reject(new Error('old save failed'))
      })

      expect(editor).toHaveValue('newer edit')
      expect(screen.getByText('Saving…')).toBeInTheDocument()
      await act(async () => { newerSave.resolve() })
      expect(screen.getByText('Saved')).toBeInTheDocument()
    },
  )

  it('does not dirty the active paper when an outgoing flush fails', async () => {
    const outgoingSave = deferred<void>()
    notesSave.mockReturnValueOnce(outgoingSave.promise)
    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'A outgoing edit' },
    })
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'A outgoing edit' })
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'B saved edit' },
    })
    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { outgoingSave.reject(new Error('flush failed')) })

    expect.soft(screen.queryByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('B saved edit')
    rerender(<NotesPanel slug="p3" />)
    await flushPromises()
    expect(notesSave).toHaveBeenCalledTimes(2)
  })

  it('disables the Clear note action when there is nothing to clear', async () => {
    notesGet.mockResolvedValue(null)

    render(<NotesPanel slug="p1" />)
    await flushPromises()

    expect(screen.getByRole('button', { name: /clear note/i })).toBeDisabled()
  })

  it('restores a failed Clear for the current edit and flushes it on navigation', async () => {
    notesGet.mockResolvedValueOnce({ body: 'keep this note' })
    notesDelete.mockRejectedValueOnce(new Error('delete failed'))
    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
    await flushPromises()

    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('keep this note')
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'keep this note' })
  })

  it('retries the current failed autosave through the outgoing flush', async () => {
    notesSave.mockRejectedValueOnce(new Error('save failed'))
    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'retry this edit' },
    })
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    expect(notesSave).toHaveBeenCalledTimes(2)
    expect(notesSave).toHaveBeenLastCalledWith({ slug: 'p1', body: 'retry this edit' })
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores an outgoing autosave result (%s) after returning to the same paper', async (outcome) => {
      const olderSave = deferred<void>()
      notesSave.mockReturnValueOnce(olderSave.promise)
      const { rerender } = render(<NotesPanel slug="p1" />)
      await flushPromises()
      fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
        target: { value: 'old visit edit' },
      })
      await act(async () => { vi.advanceTimersByTime(500) })
      rerender(<NotesPanel slug="p2" />)
      await flushPromises()
      rerender(<NotesPanel slug="p1" />)
      await flushPromises()
      fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
        target: { value: 'new visit edit' },
      })
      await act(async () => { vi.advanceTimersByTime(500) })
      await act(async () => {
        if (outcome === 'resolve') olderSave.resolve()
        else olderSave.reject(new Error('old save failed'))
      })

      expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('new visit edit')
      expect(screen.getByText('Saved')).toBeInTheDocument()
      rerender(<NotesPanel slug="p2" />)
      await flushPromises()
      expect(notesSave).toHaveBeenCalledTimes(2)
    },
  )

  it('ignores an old Clear failure after returning to the same paper without editing', async () => {
    const deletion = deferred<void>()
    notesDelete.mockReturnValueOnce(deletion.promise)
    notesGet.mockResolvedValueOnce({ body: 'old visit note' })
      .mockResolvedValueOnce({ body: 'B note' })
      .mockResolvedValueOnce({ body: 'current persisted note' })
    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    rerender(<NotesPanel slug="p1" />)
    await flushPromises()
    await act(async () => { deletion.reject(new Error('old delete failed')) })

    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('current persisted note')
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    expect(notesSave).not.toHaveBeenCalled()
  })
})
