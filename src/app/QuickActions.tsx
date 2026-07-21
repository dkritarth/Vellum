import styles from './QuickActions.module.css'

const ACTIONS = [
  ['Breakdown', 'Break down this paper section by section. Explain each part clearly.'],
  ['Practice questions', 'Create practice questions based only on this paper, then provide concise answers.'],
  ['Study guide', 'Create a focused study guide for this paper: key ideas, terms, and review plan.'],
] as const

export function QuickActions({ disabled, onPrompt }: { disabled: boolean; onPrompt: (prompt: string) => void }): JSX.Element {
  return <div className={styles.actions} aria-label="Quick actions">{ACTIONS.map(([label, prompt]) => <button key={label} type="button" disabled={disabled} onClick={() => onPrompt(prompt)}>{label}</button>)}</div>
}
