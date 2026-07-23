import { useEffect, useState } from 'react'
import styles from './DetailsPanel.module.css'
import { OrcidBadge } from './OrcidBadge'

interface PaperDetails {
  title: string
  authors: string[]
  authorOrcids?: (string | null)[]
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  summary?: string
  sections?: unknown[]
}

export function DetailsPanel({ slug }: { slug?: string }): JSX.Element {
  const [paper, setPaper] = useState<PaperDetails | null>(null)
  useEffect(() => {
    if (!slug) { setPaper(null); return }
    window.vellum.getPaper(slug).then((result) => setPaper(result)).catch(() => setPaper(null))
  }, [slug])
  if (!slug) return <p className={styles.placeholder}>No paper open — metadata will show here.</p>
  if (!paper) return <p className={styles.placeholder}>Loading paper details…</p>
  return <section className={styles.panel}>
    {paper.summary ? <><h2>Summary</h2><p>{paper.summary}</p></> : null}
    <h2>{paper.title}</h2>
    {paper.authors.length ? (
      <p>
        {paper.authors.map((name, index) => {
          const orcid = paper.authorOrcids?.[index]
          return (
            <span key={`${name}-${index}`}>
              {index > 0 ? <span aria-hidden="true">, </span> : null}
              <span>{name}</span>
              {orcid ? <OrcidBadge name={name} orcid={orcid} /> : null}
            </span>
          )
        })}
      </p>
    ) : null}
    {[paper.year, paper.venue, paper.arxivId, paper.doi].filter(Boolean).map((item) => <p key={String(item)}>{item}</p>)}
    {paper.sections?.length ? <><h3>Sections</h3><ul>{paper.sections.map((section, index) => <li key={index}>{sectionTitle(section)}</li>)}</ul></> : null}
  </section>
}

function sectionTitle(section: unknown): string {
  if (typeof section === 'object' && section !== null && 'title' in section) {
    const title = (section as Record<string, unknown>)['title']
    if (typeof title === 'string') return title
  }
  return String(section)
}
