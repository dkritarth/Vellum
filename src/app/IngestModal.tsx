import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import styles from './IngestModal.module.css'

export interface IngestModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (paper: { slug: string; title: string }) => void
}

export function IngestModal({ isOpen, onClose, onSuccess }: IngestModalProps): JSX.Element | null {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  async function handleSubmit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    const target = input.trim()
    if (!target) {
      setError('Please enter an arXiv ID, DOI, URL, or select a PDF file.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      if (!window.vellum?.ingest) {
        throw new Error('Vellum desktop bridge is not connected.')
      }
      const result = await window.vellum.ingest(target)
      setLoading(false)
      setInput('')
      onSuccess({ slug: result.slug, title: result.title })
    } catch (err: unknown) {
      setLoading(false)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    if (file) {
      // In Electron renderer, File objects have a `path` property
      const path = (file as unknown as { path?: string }).path || file.name
      setInput(path)
      setError(null)
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="ingest-modal-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="ingest-modal-title" className={styles.title}>
            Add Paper
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Close"
            onClick={onClose}
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <p className={styles.description}>
          Enter an arXiv ID, paper DOI, direct PDF URL, or select a local PDF file to ingest into your library.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <label htmlFor="paper-input">Paper identifier or URL</label>
            <input
              id="paper-input"
              type="text"
              className={styles.input}
              placeholder="e.g. 1706.03762 or 10.1145/3318464.3389700"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                if (error) setError(null)
              }}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className={styles.fileRow}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className={styles.hiddenFileInput}
              onChange={handleFileChange}
              disabled={loading}
            />
            <button
              type="button"
              className={styles.fileButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              Choose local PDF…
            </button>
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}

          {loading && (
            <div className={styles.statusMessage} aria-live="polite">
              <span>Ingesting paper… parsing and analyzing</span>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading || !input.trim()}
            >
              {loading ? 'Ingesting…' : 'Add Paper'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
