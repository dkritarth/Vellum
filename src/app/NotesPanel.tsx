// NotesPanel — [P2-01] Notes tab. One freeform markdown note per paper,
// autosaved. Talks only to `window.vellum` (preload bridge) — never imports
// Node/core directly, per AGENTS.md.
//
// Flow:
//   1. On mount / slug change: `notesGet(slug)` loads the persisted note (or
//      undefined/null if the paper has none yet — the empty-note state).
//      Editing and Clear stay disabled until this read succeeds. Failure
//      shows an explicit error and Retry, never an editable empty note.
//   2. Typing schedules a debounced `notesSave({ slug, body })` — the storage
//      layer's upsert-by-paper-slug means autosave never needs to know
//      whether a note already exists.
//   3. Switching papers (or unmounting) FLUSHES any still-pending debounced
//      save for the paper being left, rather than discarding it — an edit
//      typed <500ms before navigating away must not be lost. Both the
//      [slug] effect's cleanup and the true-unmount effect flush; a
//      `dirtyRef` guard makes a double-flush (both firing on unmount) a
//      no-op past the first.
//   4. "Clear note" deletes the persisted note outright (`notesDelete`) and
//      empties the editor — the delete half of CRUD.
//   5. If that leave-time flush fails, the text is kept in `unsavedNotes` and
//      put back in the editor, with the save error and Retry, the next time
//      the paper's note is opened (#267). It lives only for this app run.
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './NotesPanel.module.css'

const SAVE_DEBOUNCE_MS = 500

// Text whose leave-time save failed, by paper slug, with the write that
// failed. Module scope so it survives the panel unmounting (leaving the
// Notes tab) as well as a paper switch.
const unsavedNotes = new Map<string, { body: string; write: number }>()
// Latest write (save or clear) started per paper. A failed leave-time save
// is kept only while no newer write has started for that paper, and any
// write that succeeds drops what was kept from older ones, so stale text
// can never come back over a newer saved or cleared note.
const latestNoteWrite = new Map<string, number>()
let noteWriteSeq = 0

function startNoteWrite(slug: string): number {
  noteWriteSeq += 1
  latestNoteWrite.set(slug, noteWriteSeq)
  return noteWriteSeq
}

function noteWriteSucceeded(slug: string, write: number): void {
  const kept = unsavedNotes.get(slug)
  if (kept && kept.write <= write) unsavedNotes.delete(slug)
}

/** Test seam: forget text kept from failed leave-time saves. */
export function clearUnsavedNotes(): void {
  unsavedNotes.clear()
  latestNoteWrite.clear()
}

type LoadStatus = 'loading' | 'ready' | 'error'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'clearing' | 'cleared'

interface NotesPanelProps {
  /** Slug of the currently open paper, if any. Undefined = no paper open. */
  slug?: string
}

export function NotesPanel({ slug }: NotesPanelProps): JSX.Element {
  const [body, setBody] = useState('')
  const [load, setLoad] = useState<{ slug?: string; status: LoadStatus }>({ slug, status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const canEdit = load.slug === slug && load.status === 'ready'
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [mutationError, setMutationError] = useState<'save' | 'clear' | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref-mirrored so the flush path (which runs from effect cleanups, outside
  // the render that produced the latest edit) always sees the current value,
  // not a stale closure over `body`/`slug` from whenever the effect ran.
  const bodyRef = useRef('')
  const dirtyRef = useRef(false)
  // A fresh generation distinguishes revisiting the same paper from the
  // editor that issued an earlier request. Cleanup retires outgoing results.
  const paperGeneration = useRef(0)
  const editRevision = useRef(0)
  const slugRef = useRef<string | undefined>(slug)
  bodyRef.current = body
  slugRef.current = slug
  // The paper whose note this mounted editor has loaded, if any.
  const loadedSlugRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Fires a pending debounced save immediately for `outgoingSlug` instead of
  // letting the timer be silently cleared. No-ops if there's no dirty edit
  // (nothing pending) or no paper to save against.
  const flushPendingSave = useCallback((outgoingSlug: string | undefined) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!outgoingSlug || !dirtyRef.current) return
    const pendingBody = bodyRef.current
    const generation = paperGeneration.current
    const revision = editRevision.current
    dirtyRef.current = false
    const write = startNoteWrite(outgoingSlug)
    window.vellum.notesSave({ slug: outgoingSlug, body: pendingBody })
      .then(() => noteWriteSucceeded(outgoingSlug, write))
      .catch(() => {
        if (generation === paperGeneration.current && revision === editRevision.current) {
          dirtyRef.current = true
          setStatus('idle')
          return
        }
        // The flush runs from effect cleanups, which retire this generation
        // right after, so the editor that issued it is normally gone. A newer
        // save or clear for this paper supersedes it.
        if (latestNoteWrite.get(outgoingSlug) !== write) return
        if (mountedRef.current && slugRef.current === outgoingSlug && loadedSlugRef.current === outgoingSlug && !dirtyRef.current) {
          // The user is already back on this note and has not edited it:
          // show the unsaved text and the error now.
          setBody(pendingBody)
          bodyRef.current = pendingBody
          dirtyRef.current = true
          setStatus('idle')
          setMutationError('save')
          return
        }
        // Keep the text for the next time this paper's note opens.
        unsavedNotes.set(outgoingSlug, { body: pendingBody, write })
      })
  }, [])

  // Reload the note whenever the open paper changes. This cleanup fires both
  // when switching to a different paper AND on unmount — either way, flush
  // (don't discard) whatever edit is still waiting out its debounce for the
  // paper being left.
  useEffect(() => {
    paperGeneration.current += 1
    setStatus('idle')
    setMutationError(null)
    setLoad({ slug, status: 'loading' })
    loadedSlugRef.current = undefined
    dirtyRef.current = false

    if (!slug) {
      setBody('')
      dirtyRef.current = false
      return
    }

    setBody('')
    let cancelled = false
    window.vellum
      .notesGet(slug)
      .then((note) => {
        if (cancelled) return
        loadedSlugRef.current = slug
        const unsaved = unsavedNotes.get(slug)?.body
        if (unsaved !== undefined) {
          // A leave-time save of this note failed: show that text, not the
          // stored note, and offer Retry save.
          unsavedNotes.delete(slug)
          setBody(unsaved)
          bodyRef.current = unsaved
          setLoad({ slug, status: 'ready' })
          dirtyRef.current = true
          setMutationError('save')
          return
        }
        setBody(note?.body ?? '')
        setLoad({ slug, status: 'ready' })
        dirtyRef.current = false
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({ slug, status: 'error' })
          dirtyRef.current = false
        }
      })

    return () => {
      cancelled = true
      flushPendingSave(slug)
      paperGeneration.current += 1
    }
  }, [slug, loadAttempt, flushPendingSave])

  // Belt-and-suspenders true-unmount flush (empty deps — this cleanup only
  // ever runs once, on unmount, not on every slug change). Uses the
  // ref-mirrored slug since this closure is fixed at mount time. Covers the
  // panel being torn down without the [slug] effect re-running first; the
  // `dirtyRef` guard in `flushPendingSave` makes it a no-op if the [slug]
  // effect's own cleanup already flushed.
  useEffect(() => {
    return () => {
      flushPendingSave(slugRef.current)
    }
  }, [flushPendingSave])

  // Autosave and explicit retry share the same ownership checks. A new edit
  // retires earlier results without changing the draft in the editor.
  const saveNote = useCallback((paperSlug: string, next: string, generation: number, revision: number) => {
    dirtyRef.current = false
    setMutationError(null)
    setStatus('saving')
    const write = startNoteWrite(paperSlug)
    window.vellum.notesSave({ slug: paperSlug, body: next })
      .then(() => {
        noteWriteSucceeded(paperSlug, write)
        if (generation !== paperGeneration.current || revision !== editRevision.current) return
        setStatus('saved')
      })
      .catch(() => {
        if (generation !== paperGeneration.current || revision !== editRevision.current) return
        dirtyRef.current = true
        setStatus('idle')
        setMutationError('save')
      })
  }, [])

  const clearNote = useCallback(() => {
    if (!slug || !canEdit) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const previousBody = bodyRef.current
    const generation = paperGeneration.current
    const revision = ++editRevision.current
    dirtyRef.current = false
    setBody('')
    setMutationError(null)
    setStatus('clearing')
    const write = startNoteWrite(slug)
    window.vellum
      .notesDelete(slug)
      .then(() => {
        noteWriteSucceeded(slug, write)
        if (generation !== paperGeneration.current || revision !== editRevision.current) return
        setStatus('cleared')
      })
      .catch(() => {
        if (generation !== paperGeneration.current || revision !== editRevision.current) return
        setBody(previousBody)
        bodyRef.current = previousBody
        setMutationError('clear')
        dirtyRef.current = true
        setStatus('idle')
      })
  }, [slug, canEdit])

  if (!slug) return <p className={styles.placeholder}>Open a paper to add notes.</p>

  return (
    <div className={styles.notesPanel}>
      <div className={styles.header}>
        <button type="button" className={styles.clearButton} onClick={clearNote} disabled={!canEdit || !body}>
          Clear note
        </button>
        <p className={styles.status} aria-live="polite">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'clearing' ? 'Clearing…' : status === 'cleared' ? 'Cleared' : ''}</p>
      </div>
      {!canEdit && (load.slug !== slug || load.status === 'loading') && (
        <p className={styles.loadMessage} role="status">Loading note…</p>
      )}
      {load.slug === slug && load.status === 'error' && (
        <div className={styles.loadMessage}>
          <p role="alert">Could not load this note. Retry to recover saved text before editing.</p>
          <button type="button" className={styles.clearButton} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </button>
        </div>
      )}
      {canEdit && mutationError && (
        <div className={styles.loadMessage}>
          <p role="alert">{mutationError === 'save'
            ? 'Could not save this note. Your unsaved text is still in the editor.'
            : 'Could not clear this note. Your text has been restored.'}</p>
          <button type="button" className={styles.clearButton} onClick={() => {
            if (mutationError === 'clear') clearNote()
            else saveNote(slug, bodyRef.current, paperGeneration.current, ++editRevision.current)
          }}>
            {mutationError === 'clear' ? 'Retry Clear' : 'Retry save'}
          </button>
        </div>
      )}
      <textarea
        className={styles.editor}
        aria-label="Note"
        placeholder="Write notes about this paper…"
        value={body}
        disabled={!canEdit}
        onChange={(event) => {
          if (!canEdit) return
          const next = event.target.value
          setBody(next)
          bodyRef.current = next
          editRevision.current += 1
          dirtyRef.current = true
          const generation = paperGeneration.current
          const revision = editRevision.current

          if (saveTimer.current) clearTimeout(saveTimer.current)
          setStatus('idle')
          setMutationError(null)
          saveTimer.current = setTimeout(() => {
            saveTimer.current = null
            saveNote(slug, next, generation, revision)
          }, SAVE_DEBOUNCE_MS)
        }}
      />
    </div>
  )
}
