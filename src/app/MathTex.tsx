// Typesets model-supplied LaTeX with KaTeX. This is the one place assistant
// output becomes HTML, so the options below are part of the security
// boundary: `trust: false` makes KaTeX refuse \href, \url, \includegraphics
// and the \html* commands, so a formula cannot create links, load remote
// resources, or set ids, classes, styles or data attributes. KaTeX escapes
// all text it emits. Fonts and CSS ship in the app bundle, so rendering works
// offline. Formulas KaTeX cannot parse fall back to their readable source.

import katex from 'katex'
// Copying a selection that contains typeset math yields its LaTeX source
// instead of KaTeX's duplicated HTML and MathML text.
import 'katex/contrib/copy-tex'
import 'katex/dist/katex.min.css'

import styles from './MarkdownText.module.css'

const OPTIONS = {
  throwOnError: true,
  trust: false,
  strict: 'ignore',
  output: 'htmlAndMathml',
  maxSize: 20,
  maxExpand: 500,
} as const

// Streaming re-renders the whole answer on every chunk; cache finished
// formulas so each one is typeset once.
const CACHE_LIMIT = 500
const cache = new Map<string, string | null>()

export function renderTex(tex: string, display: boolean): string | null {
  const key = `${display ? 'D' : 'I'}${tex}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  let html: string | null
  try {
    html = katex.renderToString(tex, { ...OPTIONS, displayMode: display })
  } catch {
    html = null
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, html)
  return html
}

type MathTexProps = {
  tex: string
  // Original text including delimiters, shown when the formula cannot render.
  source: string
  display: boolean
  // Display formula that is its own block (not inside a paragraph).
  block?: boolean
}

export function MathTex({ tex, source, display, block = false }: MathTexProps) {
  const html = tex.trim() ? renderTex(tex, display) : null
  if (html === null) {
    const Fallback = block ? 'pre' : 'code'
    return (
      <Fallback className={block ? styles.mathErrorBlock : styles.mathError} data-math-error="" title="Formula could not be rendered">
        {source}
      </Fallback>
    )
  }
  const Wrapper = block ? 'div' : 'span'
  return (
    <Wrapper
      className={display ? styles.mathDisplay : styles.math}
      {...(display ? { 'data-math-display': '' } : {})}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
