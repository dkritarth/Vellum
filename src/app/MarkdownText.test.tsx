// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownText, parseBlocks } from './MarkdownText'

describe('MarkdownText', () => {
  it('renders bold, lists and inline code instead of raw markers', () => {
    const { container } = render(
      <MarkdownText text={'The paper reports:\n\n- **English-to-German:** **28.4 BLEU**\n- uses `d_model`\n\n1. one\n2. two'} />,
    )
    expect(container.textContent).not.toContain('**')
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(container.querySelector('strong')?.textContent).toBe('English-to-German:')
    expect(container.querySelector('code')?.textContent).toBe('d_model')
  })

  it('strips LaTeX delimiters from inline and display math', () => {
    const { container } = render(<MarkdownText text={'With \\(h = 8\\) heads.\n\n$$\nd_k = 64\n$$'} />)
    expect(container.textContent).toContain('With h = 8 heads.')
    expect(container.textContent).toContain('d_k = 64')
    expect(container.textContent).not.toMatch(/\\\(|\$\$/)
  })

  it('never turns model output into live HTML or links', () => {
    const { container } = render(
      <MarkdownText text={'<img src=x onerror=alert(1)> see [docs](https://example.com) and <script>x</script>'} />,
    )
    expect(container.querySelector('img, script, a')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(container.textContent).toContain('docs')
  })

  it('leaves dollar amounts and snake_case words alone', () => {
    const { container } = render(<MarkdownText text={'Costs $5 and $10 per snake_case_name run.'} />)
    expect(container.textContent).toBe('Costs $5 and $10 per snake_case_name run.')
    expect(container.querySelector('em')).toBeNull()
  })

  it('keeps fenced code verbatim', () => {
    expect(parseBlocks('```\n**not bold**\n```')).toEqual([{ kind: 'code', text: '**not bold**' }])
  })
})
