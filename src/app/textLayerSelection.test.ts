// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { bindTextLayerSelection } from './textLayerSelection'

function makeLayer(): HTMLElement {
  const layer = document.createElement('div')
  layer.setAttribute('data-text-layer', '')
  const span = document.createElement('span')
  span.textContent = 'Attention Is All You Need'
  layer.append(span)
  document.body.append(layer)
  return layer
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('bindTextLayerSelection', () => {
  it('appends an end-of-content guard after the text', () => {
    const layer = makeLayer()
    bindTextLayerSelection(layer)
    expect(layer.lastElementChild?.className).toBe('endOfContent')
  })

  it('marks the layer as selecting on mousedown and clears it on pointerup', () => {
    const layer = makeLayer()
    bindTextLayerSelection(layer)
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(layer.hasAttribute('data-selecting')).toBe(true)
    document.dispatchEvent(new Event('pointerup'))
    expect(layer.hasAttribute('data-selecting')).toBe(false)
  })

  it('clears selecting state on window blur and when the selection empties', () => {
    const layer = makeLayer()
    bindTextLayerSelection(layer)
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new Event('blur'))
    expect(layer.hasAttribute('data-selecting')).toBe(false)

    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    expect(layer.hasAttribute('data-selecting')).toBe(false)
  })

  it('keeps a layer selecting while the selection is inside it, and resets other layers', () => {
    const first = makeLayer()
    const second = makeLayer()
    bindTextLayerSelection(first)
    bindTextLayerSelection(second)
    second.setAttribute('data-selecting', '')
    const range = document.createRange()
    range.selectNodeContents(first.querySelector('span')!)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    expect(first.hasAttribute('data-selecting')).toBe(true)
    expect(second.hasAttribute('data-selecting')).toBe(false)
  })

  it('removes its guard and listeners when unbound', () => {
    const layer = makeLayer()
    const unbind = bindTextLayerSelection(layer)
    unbind()
    expect(layer.querySelector('.endOfContent')).toBeNull()
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(layer.hasAttribute('data-selecting')).toBe(false)
  })
})
