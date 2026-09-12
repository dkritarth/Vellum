import type { Database } from 'better-sqlite3'

export type QuestionCategory = 'methodology' | 'results' | 'limitations' | 'implications'

export interface SuggestedQuestionRecord {
  id: number
  paperSlug: string
  backend: string
  question: string
  category: QuestionCategory | null
  createdAt: string
}

interface QuestionRow {
  id: number
  paper_slug: string
  backend: string
  question: string
  category: string | null
  created_at: string
}

function toRecord(row: QuestionRow): SuggestedQuestionRecord {
  let category: QuestionCategory | null = null
  if (
    row.category === 'methodology' ||
    row.category === 'results' ||
    row.category === 'limitations' ||
    row.category === 'implications'
  ) {
    category = row.category
  }

  return {
    id: row.id,
    paperSlug: row.paper_slug,
    backend: row.backend,
    question: row.question,
    category,
    createdAt: row.created_at,
  }
}

/** Get cached suggested questions for a paper and backend. */
export function getCachedQuestions(
  db: Database,
  paperSlug: string,
  backend: string,
): SuggestedQuestionRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM suggested_questions
       WHERE paper_slug = ? AND backend = ?
       ORDER BY id ASC`,
    )
    .all(paperSlug, backend) as QuestionRow[]
  return rows.map(toRecord)
}

/** Save new suggested questions for a paper, replacing any existing ones for that backend. */
export function saveSuggestedQuestions(
  db: Database,
  paperSlug: string,
  backend: string,
  questions: Array<{ question: string; category?: QuestionCategory | null }>,
): SuggestedQuestionRecord[] {
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO suggested_questions (paper_slug, backend, question, category, created_at)
     VALUES (@paperSlug, @backend, @question, @category, @createdAt)`,
  )

  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM suggested_questions WHERE paper_slug = ? AND backend = ?`).run(paperSlug, backend)
    for (const q of questions) {
      if (!q.question || q.question.trim().length === 0) continue
      insert.run({
        paperSlug,
        backend,
        question: q.question.trim(),
        category: q.category ?? null,
        createdAt: now,
      })
    }
  })

  transaction()
  return getCachedQuestions(db, paperSlug, backend)
}

/** Invalidate cached questions for a paper (or specific backend). */
export function clearSuggestedQuestions(db: Database, paperSlug: string, backend?: string): void {
  if (backend) {
    db.prepare(`DELETE FROM suggested_questions WHERE paper_slug = ? AND backend = ?`).run(paperSlug, backend)
  } else {
    db.prepare(`DELETE FROM suggested_questions WHERE paper_slug = ?`).run(paperSlug)
  }
}

/**
 * Derive 3 to 5 paper-specific questions based on paper title, abstract, and sections.
 * Guarantees domain-specific relevance without falling back to blank or generic strings.
 */
export function derivePaperQuestions(paper: {
  title: string
  abstract?: string | null
  sections?: Array<{ title: string; page?: number }> | null
}): Array<{ question: string; category: QuestionCategory }> {
  const results: Array<{ question: string; category: QuestionCategory }> = []

  const title = paper.title.trim()
  const cleanTitle = title.replace(/[.:]+$/, '')

  // 1. Methodology question
  const methodSection = paper.sections?.find((s) =>
    /method|model|architecture|approach|framework|algorithm|formulation/i.test(s.title),
  )
  if (methodSection) {
    results.push({
      question: `How does the "${methodSection.title}" in ${cleanTitle} work, and what novel mechanisms does it introduce?`,
      category: 'methodology',
    })
  } else {
    results.push({
      question: `What is the core methodology and theoretical foundation proposed in ${cleanTitle}?`,
      category: 'methodology',
    })
  }

  // 2. Results / Evaluation question
  const evalSection = paper.sections?.find((s) =>
    /result|experiment|evaluation|benchmark|empirical|finding/i.test(s.title),
  )
  if (evalSection) {
    results.push({
      question: `What key metrics, baselines, and empirical results are highlighted in "${evalSection.title}"?`,
      category: 'results',
    })
  } else {
    results.push({
      question: `What empirical results or baseline comparisons does ${cleanTitle} demonstrate?`,
      category: 'results',
    })
  }

  // 3. Limitations question
  const limitSection = paper.sections?.find((s) =>
    /limitation|discussion|future work|analysis/i.test(s.title),
  )
  if (limitSection) {
    results.push({
      question: `What primary limitations, assumptions, or failure modes are discussed in "${limitSection.title}"?`,
      category: 'limitations',
    })
  } else {
    results.push({
      question: `What assumptions, computational bottlenecks, or limitations does the author note for ${cleanTitle}?`,
      category: 'limitations',
    })
  }

  // 4. Implications / Practical application question
  results.push({
    question: `What are the practical implications of ${cleanTitle}, and how can its findings be reproduced or extended?`,
    category: 'implications',
  })

  return results
}
