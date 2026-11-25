// Minimal markdown renderer for assistant answers. Agents reply in markdown
// (bold, lists, headings, code, LaTeX); showing it raw left `**28.4**` and
// `\(h = 8\)` in the Ask panel. Text is built as React elements and never
// injected as HTML, so model output cannot add markup or scripts. Links render
// as plain text: opening agent-chosen URLs from the app is not wanted. The
// only injected HTML is KaTeX output (see MathTex), generated with trust off.

import { Fragment, type ReactNode } from 'react'

import { MathTex } from './MathTex'
import styles from './MarkdownText.module.css'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'math'; text: string; open?: boolean; opener?: string; closer?: string }
  | { kind: 'rule' }

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/
// `\[1\]` or `\[2, 3\]`: a citation whose brackets the model escaped.
const ESCAPED_CITATION = /^\d+(?:\s*[,–-]\s*\d+)*$/

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

    const fence = trimmed.match(/^(`{3,}|~{3,})/)
    if (fence) {
      // A fence closes on a line of the same character, at least as long.
      flush()
      const marker = fence[1]
      const closes = (candidate: string): boolean => {
        const close = candidate.trim().match(/^(`{3,}|~{3,})$/)
        return !!close && close[1][0] === marker[0] && close[1].length >= marker.length
      }
      const code: string[] = []
      for (i++; i < lines.length && !closes(lines[i]); i++) code.push(lines[i])
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const mathOpen = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\[' : null
    if (mathOpen) {
      const closer = mathOpen === '$$' ? '$$' : '\\]'
      const first = trimmed.slice(2)
      const oneLine = first.length >= 2 && first.endsWith(closer) && !first.slice(0, -2).includes(closer)
      if (oneLine && !(mathOpen === '\\[' && ESCAPED_CITATION.test(first.slice(0, -2).trim()))) {
        // One-line display: `$$ x $$` or `\[ x \]`.
        flush()
        blocks.push({ kind: 'math', text: first.slice(0, -2).trim(), opener: mathOpen, closer })
        continue
      }
      if (!oneLine && !first.includes(closer)) {
        // Multi-line display block. Inside a list, an indented block belongs
        // to the current item instead of ending the list.
        const inItem = list !== null && /^\s+/.test(line)
        if (!inItem) flush()
        const math: string[] = first.trim() ? [first] : []
        let closed = false
        for (i++; i < lines.length; i++) {
          const at = lines[i].indexOf(closer)
          if (at >= 0) {
            math.push(lines[i].slice(0, at))
            closed = true
            // Text after the closing delimiter (`$$ where ...`, `\] (2)`) is
            // parsed again as its own line rather than swallowed.
            const rest = lines[i].slice(at + closer.length)
            if (rest.trim()) {
              lines[i] = rest
              i--
            }
            break
          }
          math.push(lines[i])
        }
        const text = math.join('\n').trim()
        if (inItem && closed && list) {
          // TeX ignores newlines (rows use \\), so the block fits on one line.
          // A TeX `%` comment would swallow every later line once joined, so
          // strip comments per line first.
          const joined = math.map((part) => part.replace(/(?<!\\)%.*$/, '').trim()).join(' ').trim()
          list.items[list.items.length - 1] += ` $$${joined}$$`
          continue
        }
        if (inItem) flush()
        // An unclosed fence is a formula still streaming in.
        blocks.push(closed
          ? { kind: 'math', text, opener: mathOpen, closer }
          : { kind: 'math', text, open: true })
        continue
      }
      // Otherwise (`$$a$$ and $$b$$`, `\[1\] Smith`) the inline renderer handles it.
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

// Order matters only for matches at the same index; the earliest match wins.
// Code spans and escaped `\$` keep their literal meaning. Single-dollar math
// follows Pandoc's rule so prices stay text: the opening `$` is followed by a
// non-space, the closing `$` follows a non-space and is not followed by a
// digit, and the formula cannot span a newline or a code span. A letter may
// follow (`the $n$th row`), except after an upper-case identifier, so shell
// variables (`$PATH$HOME`) stay text. Inline `$$...$$` has the same no-space
// rule at both ends, so prose about `$$` delimiters is not typeset. Every
// repeated class is bounded so unclosed delimiters in very long lines cannot
// make matching quadratic while an answer streams.
const INLINE = new RegExp([
  /(`[^`\n]{1,1000}`)/.source, // 1 code
  /(\\\$)/.source, // 2 escaped dollar
  /(\\\((.{1,2000}?)\\\))/.source, // 3,4 \( \)
  /(\$\$(?!\s)((?:\\.|[^$\\\n]){1,2000}?)(?<!\s)\$\$)/.source, // 5,6 $$ $$
  /(\$(?![\s$])((?:\\.|[^$\\`\n]){0,1000}?)(?<![\s\\])\$(?![\d$])(?!(?<=\$[A-Z_][A-Z0-9_]{1,100}\$)[A-Za-z_]))/.source, // 7,8 $ $
  /(\*\*(.{1,2000}?)\*\*|__(.{1,2000}?)__)/.source, // 9,10,11 strong
  /(\*([^*\n]{1,1000}?)\*|(?<![\w])_([^_\n]{1,1000}?)_(?![\w]))/.source, // 12,13,14 em
  /(\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})\))/.source, // 15,16,17 link
  /(\\\[(\d+(?:\s*[,–-]\s*\d+)*)\\\])/.source, // 18,19 escaped citation \[1\]
  /(\\\[(.{1,2000}?)\\\])/.source, // 20,21 \[ \] inside a line
].join('|'), 'g')

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    const key = `${keyPrefix}-${n++}`
    if (match[1]) nodes.push(<code key={key} className={styles.code}>{match[1].slice(1, -1)}</code>)
    else if (match[2]) nodes.push('$')
    else if (match[3]) nodes.push(<MathTex key={key} tex={match[4]} source={match[3]} display={false} />)
    else if (match[5]) nodes.push(<MathTex key={key} tex={match[6]} source={match[5]} display />)
    else if (match[7]) nodes.push(<MathTex key={key} tex={match[8]} source={match[7]} display={false} />)
    else if (match[9]) nodes.push(<strong key={key}>{renderInline(match[10] ?? match[11], key)}</strong>)
    else if (match[12]) nodes.push(<em key={key}>{renderInline(match[13] ?? match[14], key)}</em>)
    else if (match[15]) nodes.push(<span key={key} className={styles.link} title={match[17]}>{renderInline(match[16], key)}</span>)
    else if (match[18]) nodes.push(`[${match[19]}]`)
    else if (match[20]) nodes.push(<MathTex key={key} tex={match[21]} source={match[20]} display />)
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
            return block.open
              ? <pre key={key} className={styles.mathPending} data-math-pending="">{block.text}</pre>
              : <MathTex key={key} tex={block.text} source={`${block.opener ?? '$$'}\n${block.text}\n${block.closer ?? '$$'}`} display block />
          case 'rule':
            return <hr key={key} />
          default:
            return <Fragment key={key} />
        }
      })}
    </div>
  )
}
