import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYOUT, PANEL_LIMITS, clampWidth, parseLayout } from './panelLayout'

describe('panelLayout', () => {
  it('clamps widths to the limits of each side', () => {
    expect(clampWidth('left', 10)).toBe(PANEL_LIMITS.left.min)
    expect(clampWidth('right', 5000)).toBe(PANEL_LIMITS.right.max)
    expect(clampWidth('right', 400.4)).toBe(400)
    expect(clampWidth('left', Number.NaN)).toBe(PANEL_LIMITS.left.default)
  })

  it('restores a stored layout and repairs invalid fields', () => {
    expect(parseLayout(JSON.stringify({ leftWidth: 300, rightWidth: 500, leftCollapsed: true, rightCollapsed: false })))
      .toEqual({ leftWidth: 300, rightWidth: 500, leftCollapsed: true, rightCollapsed: false })
    expect(parseLayout(JSON.stringify({ leftWidth: 'wide', rightWidth: 99999, rightCollapsed: 'yes' })))
      .toEqual({ ...DEFAULT_LAYOUT, rightWidth: PANEL_LIMITS.right.max })
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
  })
})
