// ModelSelector — [P1-11] backend picker for Ask chat. The selected value
// becomes part of a fresh persisted chat session before its next turn runs.

import styles from './ModelSelector.module.css'

export type ChatBackend = 'claude' | 'codex'

interface ModelSelectorProps {
  backend: ChatBackend
  disabled?: boolean
  onChange: (backend: ChatBackend) => void
}

export function ModelSelector({ backend, disabled = false, onChange }: ModelSelectorProps): JSX.Element {
  return (
    <label className={styles.label}>
      <span>Model</span>
      <select
        className={styles.select}
        aria-label="Model backend"
        value={backend}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ChatBackend)}
      >
        <option value="claude">Claude</option>
        <option value="codex">Codex</option>
      </select>
    </label>
  )
}
