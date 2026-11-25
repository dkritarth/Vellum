// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Count formula renders: a finished answer re-rendered would render its
// formula again.
const mathRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./MathTex', () => ({
  MathTex: ({ tex }: { tex: string }) => {
    mathRenders.count += 1
    return <span>{tex}</span>
  },
}))

import { MarkdownText } from './MarkdownText'

describe('MarkdownText re-rendering', () => {
  it('does not re-render a finished answer while a later answer streams', () => {
    // Each streamed chunk re-renders the whole thread. A finished answer keeps
    // its text, so it must not be parsed and typeset again on every chunk.
    const thread = (streaming: string) => (
      <>
        <MarkdownText text={'Finished answer with $x^2$ math.'} />
        <MarkdownText text={streaming} />
      </>
    )
    const { rerender } = render(thread('Streaming'))
    expect(mathRenders.count).toBe(1)
    rerender(thread('Streaming more'))
    rerender(thread('Streaming more text'))
    expect(mathRenders.count).toBe(1)
  })
})
