import styles from './OrcidBadge.module.css'

export function OrcidBadge({ name, orcid }: { name: string; orcid: string }): JSX.Element {
  return (
    <a
      className={styles.badge}
      href={`https://orcid.org/${orcid}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`ORCID profile for ${name}`}
    >
      ORCID
    </a>
  )
}
