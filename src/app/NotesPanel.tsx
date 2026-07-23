// NotesPanel — [P2-01] Notes tab. One freeform markdown note per paper,
// autosaved. Talks only to `window.vellum` (preload bridge) — never imports
// Node/core directly, per AGENTS.md.
//
// Flow:
//   1. On mount / slug change: `notesGet(slug)` loads the persisted note (or
//      undefined/null if the paper has none yet — the empty-note state).
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
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './NotesPanel.module.css'

const SAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'saving' | 'saved'

interface NotesPanelProps {
  /** Slug of the currently open paper, if any. Undefined = no paper open. */
  slug?: string
}

export function NotesPanel({ slug }: NotesPanelProps): JSX.Element {
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref-mirrored so the flush path (which runs from effect cleanups, outside
  // the render that produced the latest edit) always sees the current value,
  // not a stale closure over `body`/`slug` from whenever the effect ran.
  const bodyRef = useRef('')
  const dirtyRef = useRef(false)
  const slugRef = useRef<string | undefined>(slug)
  bodyRef.current = body
  slugRef.current = slug

  // Fires a pending debounced save immediately for `outgoingSlug` instead of
  // letting the timer be silently cleared. No-ops if there's no dirty edit
  // (nothing pending) or no paper to save against.
  const flushPendingSave = useCallback((outgoingSlug: string | undefined) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!outgoingSlug || !dirtyRef.current) return
    dirtyRef.current = false
    window.vellum.notesSave({ slug: outgoingSlug, body: bodyRef.current }).catch(() => undefined)
  }, [])

  // Reload the note whenever the open paper changes. This cleanup fires both
  // when switching to a different paper AND on unmount — either way, flush
  // (don't discard) whatever edit is still waiting out its debounce for the
  // paper being left.
  useEffect(() => {
    setStatus('idle')

    if (!slug) {
      setBody('')
      dirtyRef.current = false
      return
    }

    let cancelled = false
    window.vellum
      .notesGet(slug)
      .then((note) => {
        if (cancelled) return
        setBody(note?.body ?? '')
        dirtyRef.current = false
      })
      .catch(() => {
        if (!cancelled) {
          setBody('')
          dirtyRef.current = false
        }
      })

    return () => {
      cancelled = true
      flushPendingSave(slug)
    }
  }, [slug, flushPendingSave])

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

  const clearNote = useCallback(() => {
    if (!slug) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    dirtyRef.current = false
    setBody('')
    setStatus('saving')
    window.vellum
      .notesDelete(slug)
      .then(() => setStatus('idle'))
      .catch(() => setStatus('idle'))
  }, [slug])

  if (!slug) return <p className={styles.placeholder}>Open a paper to add notes.</p>

  return (
    <div className={styles.notesPanel}>
      <div className={styles.header}>
        <button type="button" className={styles.clearButton} onClick={clearNote} disabled={!body}>
          Clear note
        </button>
        <p className={styles.status}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}</p>
      </div>
      <textarea
        className={styles.editor}
        aria-label="Note"
        placeholder="Write notes about this paper…"
        value={body}
        onChange={(event) => {
          const next = event.target.value
          setBody(next)
          bodyRef.current = next
          dirtyRef.current = true

          if (saveTimer.current) clearTimeout(saveTimer.current)
          setStatus('idle')
          saveTimer.current = setTimeout(() => {
            dirtyRef.current = false
            setStatus('saving')
            window.vellum
              .notesSave({ slug, body: next })
              .then(() => setStatus('saved'))
              .catch(() => setStatus('idle'))
          }, SAVE_DEBOUNCE_MS)
        }}
      />
    </div>
  )
}
