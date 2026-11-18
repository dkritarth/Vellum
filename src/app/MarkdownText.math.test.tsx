// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownText, parseBlocks } from './MarkdownText'

// Regression input from issue #228 (Neural ODE answer screenshot).
const NEURAL_ODE = [
  'The residual update is $h_{t+1} = h_t + f(h_t, \\theta_t)$, where $f$ is a neural network.',
  '',
  '$$',
  '\\frac{dh(t)}{dt} = f(h(t), t, \\theta)',
  '$$',
  '',
  'The adjoint is $a(t) = \\partial L / \\partial z(t)$.',
  '',
  '\\[',
  '\\frac{da(t)}{dt} = -a(t)^T \\frac{\\partial f(z(t), t, \\theta)}{\\partial z}',
  '\\]',
].join('\n')

// Visible (non-MathML) text: what the reader actually sees.
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex-mathml').forEach((node) => node.remove())
  return clone.textContent ?? ''
}

describe('MarkdownText math rendering (#228)', () => {
  it('typesets the Neural ODE inline and display examples', () => {
    const { container } = render(<MarkdownText text={NEURAL_ODE} />)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
    expect(container.querySelectorAll('.katex')).toHaveLength(5)
    const visible = visibleText(container)
    expect(visible).not.toContain('$')
    expect(visible).not.toMatch(/\\(frac|partial|theta)/)
    expect(container.querySelector('.katex .mfrac')).not.toBeNull()
    expect(visible).toContain('θ')
    expect(visible).toContain('∂')
    // MathML is kept for accessibility.
    expect(container.querySelector('math')).not.toBeNull()
  })

  it('typesets \\( \\) inline and one-line $$ display math', () => {
    const { container } = render(<MarkdownText text={'With \\(h = 8\\) heads.\n\n$$d_k = 64$$'} />)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(visibleText(container)).not.toMatch(/\\\(|\$\$/)
  })

  it('renders matrices and aligned multiline equations', () => {
    const text = '$$\n\\begin{aligned}\na &= b + c \\\\\nd &= \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}\n\\end{aligned}\n$$'
    const { container } = render(<MarkdownText text={text} />)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('.math-error, [data-math-error]')).toBeNull()
    expect(visibleText(container)).not.toContain('\\begin')
  })

  it('renders math inside list items next to bold text and citations', () => {
    const { container } = render(
      <MarkdownText text={'- **Dynamics:** $\\dot z = f(z, t)$ [p. 3]\n- plain item'} />,
    )
    const item = container.querySelector('ul > li')!
    expect(item.querySelector('strong')?.textContent).toBe('Dynamics:')
    expect(item.querySelector('.katex')).not.toBeNull()
    expect(visibleText(item as HTMLElement)).toContain('[p. 3]')
  })

  it('keeps currency, escaped dollars, inline code and fenced code literal', () => {
    const { container } = render(
      <MarkdownText
        text={'Costs $5 and $10, or $5-$10. Escaped \\$x\\$ stays. Code `$x$` too.\n\n```\n$$not math$$\n```'}
      />,
    )
    expect(container.querySelector('.katex')).toBeNull()
    const text = container.textContent ?? ''
    expect(text).toContain('Costs $5 and $10, or $5-$10.')
    expect(text).toContain('Escaped $x$ stays.')
    expect(container.querySelector('p code')?.textContent).toBe('$x$')
    expect(container.querySelector('pre code')?.textContent).toBe('$$not math$$')
  })

  it('shows readable source for malformed or unsupported LaTeX instead of crashing', () => {
    const { container } = render(<MarkdownText text={'Bad $\\notacommand{x}$ and $\\frac{a$ here.\n\n$$\n\\frac{1\n$$'} />)
    const errors = container.querySelectorAll('[data-math-error]')
    expect(errors.length).toBe(3)
    const text = container.textContent ?? ''
    expect(text).toContain('\\notacommand{x}')
    expect(text).toContain('\\frac{1')
    expect(text).toContain('here.')
  })

  it('shows an unclosed streamed display formula as source, then typesets it once closed', () => {
    const partial = 'Intro.\n\n$$\n\\frac{dh}{dt} = f('
    expect(parseBlocks(partial).at(-1)).toEqual({ kind: 'math', text: '\\frac{dh}{dt} = f(', open: true })
    const { container, rerender } = render(<MarkdownText text={partial} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.querySelector('[data-math-error]')).toBeNull()
    expect(container.textContent).toContain('\\frac{dh}{dt} = f(')

    rerender(<MarkdownText text={`${partial}h)\n$$\n\nDone.`} />)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.textContent).toContain('Done.')

    // Unclosed inline math while streaming stays plain text.
    rerender(<MarkdownText text={'The value $h_{t+1} = h'} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toBe('The value $h_{t+1} = h')
  })

  it('cannot produce links, images, scripts or remote resources from model math', () => {
    const text = [
      '$\\href{javascript:alert(1)}{click}$',
      '$\\url{https://example.com}$',
      '$\\includegraphics{https://example.com/x.png}$',
      '$\\htmlClass{evil}{x}$ $\\htmlStyle{background:url(https://example.com)}{x}$',
      '$\\htmlId{x}{y}$ $\\htmlData{a=b}{y}$',
      '$$<img src=x onerror=alert(1)>$$',
    ].join('\n\n')
    const { container } = render(<MarkdownText text={text} />)
    expect(container.querySelector('a, img, script, iframe, object, embed, link, style')).toBeNull()
    // Source text may appear as escaped text; no attribute may carry it.
    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name === 'xmlns') continue
        expect(attribute.name).not.toMatch(/^on|^href$|^src$|^data-(?!math-)/i)
        expect(attribute.value).not.toMatch(/javascript:|https?:|url\(/i)
      }
      expect(element.classList.contains('evil')).toBe(false)
      expect(element.id).toBe('')
    }
  })

  it('wraps display math in a horizontally scrollable container', () => {
    const { container } = render(<MarkdownText text={'$$\nx_1 + x_2 + x_3 + x_4 + x_5 + x_6 + x_7 + x_8 + x_9\n$$'} />)
    const block = container.querySelector('[data-math-display]') as HTMLElement
    expect(block).not.toBeNull()
    expect(block.querySelector('.katex-display')).not.toBeNull()
  })

  it('renders restored history identically to a fresh render', () => {
    const first = render(<MarkdownText text={NEURAL_ODE} />).container.innerHTML
    const second = render(<MarkdownText text={NEURAL_ODE} />).container.innerHTML
    expect(second).toBe(first)
  })
})
