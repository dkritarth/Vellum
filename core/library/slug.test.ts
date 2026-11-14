import { describe, expect, it } from 'vitest'
import { assertValidSlug, isValidSlug, SLUG_PATTERN } from './slug.js'

// Slugs become directory names under data/papers/<slug>/ and are passed through
// IPC from the renderer, so the validator is the traversal boundary.
describe('isValidSlug', () => {
  it.each([
    // Exact shapes classifyInput emits for each input kind.
    'arxiv-2401.12345',
    'arxiv-2401.12345v12',
    'arxiv-0704.0001',
    'doi-10.1145-3290605.3300857',
    'pdf-attention_is_all_you_need',
    'local-paper',
    // A single alphanumeric is the minimal slug.
    'a',
    '7',
    // Dots after the first char are not traversal: "a.." is an ordinary name.
    'a..',
    'a..b',
  ])('accepts %j', (slug) => {
    expect(isValidSlug(slug)).toBe(true)
    expect(() => assertValidSlug(slug)).not.toThrow()
  })

  it.each([
    ['empty string', ''],
    ['single dot', '.'],
    ['parent segment', '..'],
    ['traversal after valid prefix', 'arxiv-1/../../etc'],
    ['nested traversal with backslash', 'a\\..\\..\\b'],
    ['forward slash', 'doi-10.1000/abc'],
    ['backslash', 'a\\b'],
    ['absolute path', '/tmp/x'],
    ['windows drive path', 'C:\\x'],
    ['whitespace only', '   '],
    ['leading space', ' arxiv-1'],
    ['trailing space', 'arxiv-1 '],
    ['tab inside', 'a\tb'],
    // `$` without the m flag must not let a trailing newline through.
    ['trailing newline', 'arxiv-2401.12345\n'],
    ['embedded newline', 'a\n..'],
    ['NUL byte', 'a\u0000b'],
    ['leading hyphen (looks like a CLI flag)', '-rf'],
    ['leading underscore', '_x'],
    ['leading dot (hidden file)', '.git'],
    ['accented latin', 'résumé'],
    ['CJK', '論文'],
    ['emoji', 'paper-📄'],
    ['fullwidth solidus lookalike', 'a／b'],
    ['fullwidth digit', '１abc'],
    ['URL-encoded slash stays rejected', 'a%2Fb'],
    ['colon', 'a:b'],
  ])('rejects %s', (_label, slug) => {
    expect(isValidSlug(slug)).toBe(false)
    expect(() => assertValidSlug(slug)).toThrow(/Invalid slug format/)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 2401.12345],
    ['boolean', true],
    ['array of a valid slug', ['arxiv-1']],
    ['String object', new String('arxiv-1')],
    ['object with toString', { toString: () => 'arxiv-1' }],
  ])('rejects non-primitive-string input: %s', (_label, value) => {
    expect(isValidSlug(value)).toBe(false)
  })

  it('is stateless across repeated calls (exported pattern has no g/y flag)', () => {
    expect(SLUG_PATTERN.global).toBe(false)
    expect(SLUG_PATTERN.sticky).toBe(false)
    for (let i = 0; i < 3; i += 1) {
      expect(isValidSlug('arxiv-2401.12345')).toBe(true)
    }
  })
})

describe('assertValidSlug', () => {
  it('names the offending value in the error', () => {
    expect(() => assertValidSlug('../etc')).toThrow('Invalid slug format: ../etc')
  })

  it('throws the validation Error, not a TypeError, for values that cannot be template-stringified', () => {
    // Inputs are typed `unknown`; a Symbol or a null-prototype object used to
    // make the error message itself throw a TypeError.
    for (const value of [Symbol('slug'), Object.create(null)]) {
      let caught: unknown
      try {
        assertValidSlug(value)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      expect(caught).not.toBeInstanceOf(TypeError)
      expect((caught as Error).message).toMatch(/^Invalid slug format/)
    }
  })
})
