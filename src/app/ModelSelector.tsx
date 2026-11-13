// ModelSelector — [P1-11] backend picker for Ask chat. The selected value
// becomes part of a fresh persisted chat session before its next turn runs.

import type { AcpBackend } from '../../core/acp/client'
import styles from './ModelSelector.module.css'

export type ChatBackend = AcpBackend

/** Picker labels. Typed as a full Record so adding a backend to AcpBackend
 * fails typecheck here until it gets a label. Renderer-local on purpose: the
 * renderer imports only types from core/. */
export const BACKEND_LABELS: Record<ChatBackend, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Gemini (Antigravity)',
}

const BACKENDS = Object.keys(BACKEND_LABELS) as ChatBackend[]

export function isChatBackend(value: unknown): value is ChatBackend {
  return typeof value === 'string' && Object.hasOwn(BACKEND_LABELS, value)
}

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
        {BACKENDS.map((value) => (
          <option key={value} value={value}>
            {BACKEND_LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  )
}
