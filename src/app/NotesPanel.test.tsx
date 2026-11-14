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
    expect(textarea).toBeEnabled()
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

  it('blocks failed-read replacement and retries the original saved note', async () => {
    let stored = 'Existing research note with important evidence'
    notesGet.mockRejectedValueOnce(new Error('SQLite read failed'))
      .mockRejectedValueOnce(new Error('read failed again'))
      .mockImplementation(async () => ({ body: stored }))
    notesSave.mockImplementation(async ({ body }: { body: string }) => { stored = body })
    render(<NotesPanel slug="p1" />)
    await flushPromises()
    const editor = screen.getByRole('textbox', { name: /note/i })
    fireEvent.change(editor, { target: { value: 'replacement for unread note' } })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(stored).toBe('Existing research note with important evidence')
    expect(editor).toBeDisabled()
    expect(screen.getByRole('button', { name: /clear note/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i)
    fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
    expect(notesSave).not.toHaveBeenCalled()
    expect(notesDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await flushPromises()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(editor).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await flushPromises()
    expect(editor).toBeEnabled()
    expect(editor).toHaveValue(stored)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(notesSave).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: 'intentional loaded edit' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(stored).toBe('intentional loaded edit')
  })

  it.each(['switch', 'unmount'] as const)(
    'blocks editing and persistence while initial read is pending, then %s', async (exit) => {
      const read = deferred<{ body: string }>()
      notesGet.mockReturnValueOnce(read.promise)
      const { rerender, unmount } = render(<NotesPanel slug="p1" />)
      const editor = screen.getByRole('textbox', { name: /note/i })
      expect(screen.getByRole('status')).toHaveTextContent('Loading note…')
      expect(editor).toBeDisabled()
      expect(screen.getByRole('button', { name: /clear note/i })).toBeDisabled()
      fireEvent.change(editor, { target: { value: 'blocked loading edit' } })
      fireEvent.click(screen.getByRole('button', { name: /clear note/i }))
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(editor).toHaveValue('')
      if (exit === 'switch') rerender(<NotesPanel slug="p2" />)
      else unmount()
      await act(async () => { read.resolve({ body: 'unread original' }) })
      expect(notesSave).not.toHaveBeenCalled()
      expect(notesDelete).not.toHaveBeenCalled()
      if (exit === 'switch') expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('')
    },
  )

  it('enables a true empty editor after retry finds no saved note', async () => {
    notesGet.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(null)
    render(<NotesPanel slug="p1" />)
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await flushPromises()
    expect(screen.getByRole('textbox', { name: /note/i })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading note…')).not.toBeInTheDocument()
    expect(notesSave).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'retires retry %s after switch and revisit, preserving loaded edits', async (outcome) => {
      const retry = deferred<{ body: string }>()
      notesGet.mockRejectedValueOnce(new Error('first read failed'))
        .mockReturnValueOnce(retry.promise)
        .mockResolvedValueOnce({ body: 'B original' })
        .mockResolvedValueOnce({ body: 'A current' })
      const { rerender } = render(<NotesPanel slug="p1" />)
      await flushPromises()
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      await flushPromises()
      expect(screen.getByRole('textbox', { name: /note/i })).toBeDisabled()
      rerender(<NotesPanel slug="p2" />)
      await flushPromises()
      expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('B original')
      rerender(<NotesPanel slug="p1" />)
      await flushPromises()
      fireEvent.change(screen.getByRole('textbox', { name: /note/i }), { target: { value: 'A current edit' } })
      await act(async () => {
        if (outcome === 'resolve') retry.resolve({ body: 'obsolete A' })
        else retry.reject(new Error('obsolete error'))
      })
      expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('A current edit')
      expect(screen.getByRole('textbox', { name: /note/i })).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      rerender(<NotesPanel slug="p2" />)
      await flushPromises()
      expect(notesSave).toHaveBeenCalledTimes(1)
      expect(notesSave).toHaveBeenCalledWith({ slug: 'p1', body: 'A current edit' })
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'retires retry %s after unmount without a write', async (outcome) => {
      const retry = deferred<{ body: string }>()
      notesGet.mockRejectedValueOnce(new Error('read failed')).mockReturnValueOnce(retry.promise)
      const { unmount } = render(<NotesPanel slug="p1" />)
      await flushPromises()
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      await flushPromises()
      unmount()
      await act(async () => {
        if (outcome === 'resolve') retry.resolve({ body: 'original' })
        else retry.reject(new Error('late error'))
      })
      expect(notesSave).not.toHaveBeenCalled()
      expect(notesDelete).not.toHaveBeenCalled()
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

describe('loaded note mutation recovery', () => {
  it('retains the unsaved draft through repeated save failure and retries without another edit', async () => {
    notesGet.mockResolvedValue({ body: 'saved evidence' })
    notesSave.mockRejectedValueOnce(new Error('save failed')).mockRejectedValueOnce(new Error('still failed'))
    render(<NotesPanel slug="p1" />)
    await flushPromises()
    const editor = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(editor, { target: { value: 'new unsaved evidence' } })
    await act(async () => { vi.advanceTimersByTime(500) })

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save this note')
      expect(editor).toHaveValue('new unsaved evidence')
      expect(editor).toBeEnabled()
      expect(screen.queryByText('Saved')).not.toBeInTheDocument()
      const retry = screen.getByRole('button', { name: 'Retry save' })
      retry.focus()
      expect(retry).toHaveFocus()
      fireEvent.click(retry)
      await flushPromises()
    }
    expect(notesSave).toHaveBeenCalledTimes(3)
    expect(notesSave).toHaveBeenLastCalledWith({ slug: 'p1', body: 'new unsaved evidence' })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(notesGet).toHaveBeenCalledTimes(1)
  })

  it('restores the unsaved draft after repeated Clear failure and explicitly retries deletion', async () => {
    notesGet.mockResolvedValue({ body: 'saved evidence' })
    notesDelete.mockRejectedValueOnce(new Error('delete failed')).mockRejectedValueOnce(new Error('still failed'))
    render(<NotesPanel slug="p1" />)
    await flushPromises()
    const editor = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(editor, { target: { value: 'unsaved evidence before Clear' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear note' }))
    await flushPromises()

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not clear this note')
      expect(editor).toHaveValue('unsaved evidence before Clear')
      expect(screen.queryByText('Cleared')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry Clear' }))
      await flushPromises()
    }
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(notesDelete).toHaveBeenCalledTimes(3)
    expect(notesSave).not.toHaveBeenCalled()
    expect(editor).toHaveValue('')
    expect(screen.getByText('Cleared')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('new typing invalidates a failed Clear retry and saves the latest text', async () => {
    notesGet.mockResolvedValue({ body: 'original evidence' })
    notesDelete.mockRejectedValueOnce(new Error('delete failed'))
    notesSave.mockRejectedValueOnce(new Error('save failed'))
    render(<NotesPanel slug="p1" />)
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: 'Clear note' }))
    await flushPromises()
    expect(screen.getByRole('button', { name: 'Retry Clear' })).toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(editor, { target: { value: 'new research after failed Clear' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry Clear' })).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(500) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await flushPromises()
    expect(notesDelete).toHaveBeenCalledTimes(1)
    expect(notesSave).toHaveBeenLastCalledWith({ slug: 'p1', body: 'new research after failed Clear' })
    expect(editor).toHaveValue('new research after failed Clear')
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it.each(['save', 'clear'] as const)('a late %s retry failure cannot affect a new paper generation', async (operation) => {
    const late = deferred<void>()
    notesGet.mockResolvedValue({ body: 'persisted evidence' })
    const mutation = operation === 'save' ? notesSave : notesDelete
    mutation.mockRejectedValueOnce(new Error('first failure')).mockReturnValueOnce(late.promise)
    const { rerender } = render(<NotesPanel slug="p1" />)
    await flushPromises()
    if (operation === 'save') {
      fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'draft' } })
      await act(async () => { vi.advanceTimersByTime(500) })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Clear note' }))
      await flushPromises()
    }
    fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Retry save' : 'Retry Clear' }))
    rerender(<NotesPanel slug="p2" />)
    await flushPromises()
    rerender(<NotesPanel slug="p1" />)
    await flushPromises()
    await act(async () => { late.reject(new Error('obsolete failure')) })
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('persisted evidence')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it.each(['save', 'clear'] as const)('a late %s retry failure cannot affect newer typing', async (operation) => {
    const late = deferred<void>()
    notesGet.mockResolvedValue({ body: 'persisted evidence' })
    const mutation = operation === 'save' ? notesSave : notesDelete
    mutation.mockRejectedValueOnce(new Error('first failure')).mockReturnValueOnce(late.promise)
    render(<NotesPanel slug="p1" />)
    await flushPromises()
    const editor = screen.getByRole('textbox', { name: 'Note' })
    if (operation === 'save') {
      fireEvent.change(editor, { target: { value: 'draft' } })
      await act(async () => { vi.advanceTimersByTime(500) })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Clear note' }))
      await flushPromises()
    }
    fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Retry save' : 'Retry Clear' }))
    fireEvent.change(editor, { target: { value: 'latest draft' } })
    await act(async () => { late.reject(new Error('obsolete failure')) })
    expect(editor).toHaveValue('latest draft')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(notesSave).toHaveBeenLastCalledWith({ slug: 'p1', body: 'latest draft' })
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
})
