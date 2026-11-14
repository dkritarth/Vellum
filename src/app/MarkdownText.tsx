// Minimal markdown renderer for assistant answers. Agents reply in markdown
// (bold, lists, headings, code, inline LaTeX); showing it raw left `**28.4**`
// and `\(h = 8\)` in the Ask panel. This builds React elements directly and
// never injects HTML, so model output cannot add markup or scripts. Links
// render as plain text: opening agent-chosen URLs from the app is not wanted.

import { Fragment, type ReactNode } from 'react'

import styles from './MarkdownText.module.css'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'math'; text: string }
  | { kind: 'rule' }

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
    if (list) blocks.push({ kind: 'list', ...list })
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i])
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const mathFence = trimmed === '$$' ? '$$' : trimmed === '\\[' ? '\\]' : null
    if (mathFence) {
      flush()
      const math: string[] = []
      for (i++; i < lines.length && lines[i].trim() !== mathFence; i++) math.push(lines[i])
      blocks.push({ kind: 'math', text: math.join('\n').trim() })
      continue
    }
    const oneLineMath = trimmed.match(/^(?:\$\$(.+)\$\$|\\\[(.+)\\\])$/)
    if (oneLineMath) {
      flush()
      blocks.push({ kind: 'math', text: (oneLineMath[1] ?? oneLineMath[2]).trim() })
      continue
    }
    if (trimmed === '') {
      flush()
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      continue
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }
    const item = line.match(LIST_ITEM)
    if (item) {
      const ordered = item[2] !== undefined
      if (paragraph.length) flush()
      if (list && list.ordered !== ordered) flush()
      if (!list) list = { ordered, items: [] }
      list.items.push(item[3])
      continue
    }
    if (list && /^\s+\S/.test(line)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${trimmed}`
      continue
    }
    if (list) flush()
    paragraph.push(line)
  }
  flush()
  return blocks
}

// Order matters: code first so its contents are not parsed further. Single
// `$` is not math: answers quote prices and shell variables far more often.
const INLINE = /(`[^`\n]+`)|(\\\((.+?)\\\))|(\$\$([^$\n]+?)\$\$)|(\*\*(.+?)\*\*|__(.+?)__)|(\*([^*\n]+?)\*|(?<![\w])_([^_\n]+?)_(?![\w]))|(\[([^\]\n]+)\]\(([^)\s]+)\))/g

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    const key = `${keyPrefix}-${n++}`
    if (match[1]) nodes.push(<code key={key} className={styles.code}>{match[1].slice(1, -1)}</code>)
    else if (match[2]) nodes.push(<span key={key} className={styles.math}>{match[3]}</span>)
    else if (match[4]) nodes.push(<span key={key} className={styles.math}>{match[5]}</span>)
    else if (match[6]) nodes.push(<strong key={key}>{renderInline(match[7] ?? match[8], key)}</strong>)
    else if (match[9]) nodes.push(<em key={key}>{renderInline(match[10] ?? match[11], key)}</em>)
    else if (match[12]) nodes.push(<span key={key} className={styles.link} title={match[14]}>{renderInline(match[13], key)}</span>)
    last = index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function withLineBreaks(text: string, key: string): ReactNode[] {
  return text.split('\n').flatMap((line, i) => (i === 0
    ? renderInline(line, `${key}-${i}`)
    : [<br key={`${key}-br-${i}`} />, ...renderInline(line, `${key}-${i}`)]))
}

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      {parseBlocks(text).map((block, i) => {
        const key = `b${i}`
        switch (block.kind) {
          case 'heading':
            return <p key={key} className={styles.heading}>{renderInline(block.text, key)}</p>
          case 'paragraph':
            return <p key={key}>{withLineBreaks(block.text, key)}</p>
          case 'list': {
            const items = block.items.map((item, j) => <li key={j}>{renderInline(item, `${key}-${j}`)}</li>)
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
          }
          case 'code':
            return <pre key={key} className={styles.pre}><code>{block.text}</code></pre>
          case 'math':
            return <p key={key} className={styles.mathBlock}>{block.text}</p>
          case 'rule':
            return <hr key={key} />
          default:
            return <Fragment key={key} />
        }
      })}
    </div>
  )
}
