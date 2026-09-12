import { useCallback, useEffect, useState } from 'react'
import type { QuestionCategory, SuggestedQuestionRecord } from '../../core/questions/repo'
import styles from './SuggestedQuestions.module.css'

interface SuggestedQuestionsProps {
  slug: string
  backend: 'claude' | 'codex'
  disabled: boolean
  onSelectQuestion: (question: string) => void
}

function getCategoryBadge(category: QuestionCategory | null): { label: string; className: string } {
  switch (category) {
    case 'methodology':
      return { label: 'Method', className: styles.badgeMethodology }
    case 'results':
      return { label: 'Results', className: styles.badgeResults }
    case 'limitations':
      return { label: 'Limits', className: styles.badgeLimitations }
    case 'implications':
      return { label: 'Impact', className: styles.badgeImplications }
    default:
      return { label: 'Question', className: styles.badgeImplications }
  }
}

export function SuggestedQuestions({
  slug,
  backend,
  disabled,
  onSelectQuestion,
}: SuggestedQuestionsProps): JSX.Element | null {
  const [questions, setQuestions] = useState<SuggestedQuestionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadQuestions = useCallback(
    async (forceRegenerate = false) => {
      setLoading(true)
      setError(null)
      try {
        const fetcher = forceRegenerate
          ? window.vellum.questionsRegenerate
          : window.vellum.questionsGet
        const data = await fetcher(slug, backend)
        setQuestions(data)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [slug, backend],
  )

  useEffect(() => {
    void loadQuestions(false)
  }, [loadQuestions])

  if (!loading && questions.length === 0 && !error) {
    return null
  }

  return (
    <div className={styles.container} aria-label="Suggested questions">
      <div className={styles.header}>
        <span className={styles.title}>Suggested Questions</span>
        <button
          type="button"
          className={styles.refreshBtn}
          disabled={disabled || loading}
          onClick={() => void loadQuestions(true)}
          title="Regenerate questions"
          aria-label="Regenerate suggested questions"
        >
          🔄 {loading ? 'Thinking…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className={styles.errorText} role="alert">
          <span>Failed to load suggestions. </span>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => void loadQuestions(false)}
          >
            Retry
          </button>
        </div>
      ) : loading && questions.length === 0 ? (
        <div className={styles.loadingText}>Generating paper questions…</div>
      ) : (
        <div className={styles.questionsList} role="group" aria-label="Questions list">
          {questions.map((item) => {
            const badge = getCategoryBadge(item.category)
            return (
              <button
                key={item.id}
                type="button"
                className={styles.questionChip}
                disabled={disabled}
                onClick={() => onSelectQuestion(item.question)}
              >
                <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                <span className={styles.questionText}>{item.question}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
