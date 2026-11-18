// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { bindTextLayerSelection, snapSelectionStart } from './textLayerSelection'

const unbinds: Array<() => void> = []
function bind(layer: HTMLElement): () => void {
  const unbind = bindTextLayerSelection(layer)
  unbinds.push(unbind)
  return unbind
}

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
  // Unbinding everything also proves the last unbind removes the shared listeners.
  for (const unbind of unbinds.splice(0)) unbind()
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('bindTextLayerSelection', () => {
  it('appends an end-of-content guard after the text', () => {
    const layer = makeLayer()
    bind(layer)
    expect(layer.lastElementChild?.className).toBe('endOfContent')
  })

  it('marks the layer as selecting on mousedown and clears it on pointerup', () => {
    const layer = makeLayer()
    bind(layer)
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(layer.hasAttribute('data-selecting')).toBe(true)
    document.dispatchEvent(new Event('pointerup'))
    expect(layer.hasAttribute('data-selecting')).toBe(false)
  })

  it('clears selecting state on window blur and when the selection empties', () => {
    const layer = makeLayer()
    bind(layer)
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
    bind(first)
    bind(second)
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
    const unbind = bind(layer)
    unbind()
    expect(layer.querySelector('.endOfContent')).toBeNull()
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(layer.hasAttribute('data-selecting')).toBe(false)
  })

  it('refuses to bind the same layer twice', () => {
    const layer = makeLayer()
    bind(layer)
    expect(() => bindTextLayerSelection(layer)).toThrow('already bound')
    expect(layer.querySelectorAll('.endOfContent')).toHaveLength(1)
  })
})

describe('snapSelectionStart', () => {
  // Title line spans x 100..300, y 50..70 (client coordinates).
  function lineLayer(withCitation = false): { layer: HTMLElement; text: Text; span: HTMLElement } {
    const layer = makeLayer()
    const span = layer.querySelector('span') as HTMLElement
    if (withCitation) {
      span.textContent = 'See '
      const button = document.createElement('button')
      button.textContent = '[1] for details'
      span.append(button)
    }
    span.getBoundingClientRect = () => ({ left: 100, right: 300, top: 50, bottom: 70, x: 100, y: 50, width: 200, height: 20, toJSON() {} }) as DOMRect
    return { layer, text: span.firstChild as Text, span }
  }

  function select(anchor: Node, anchorOffset: number, focus: Node, focusOffset: number): Selection {
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
    return selection
  }

  it('moves a forward selection that began left of the line to its first character', () => {
    const { layer, text } = lineLayer()
    const selection = select(text, 1, text, text.length)
    snapSelectionStart({ layer, x: 94, y: 60 }, selection)
    expect(selection.toString()).toBe('Attention Is All You Need')
  })

  it('treats a start on the left edge as the line start', () => {
    const { layer, text } = lineLayer()
    const selection = select(text, 1, text, text.length)
    snapSelectionStart({ layer, x: 100.2, y: 60 }, selection)
    expect(selection.anchorOffset).toBe(0)
  })

  it('leaves selections alone when the drag began inside the text', () => {
    const { layer, text } = lineLayer()
    const selection = select(text, 4, text, text.length)
    snapSelectionStart({ layer, x: 140, y: 60 }, selection)
    expect(selection.anchorOffset).toBe(4)
  })

  it('leaves selections alone when the drag began on another line', () => {
    const { layer, text } = lineLayer()
    const selection = select(text, 1, text, text.length)
    snapSelectionStart({ layer, x: 94, y: 120 }, selection)
    expect(selection.anchorOffset).toBe(1)
  })

  it('leaves backward selections alone', () => {
    const { layer, text } = lineLayer()
    const selection = select(text, text.length, text, 1)
    snapSelectionStart({ layer, x: 94, y: 60 }, selection)
    expect(selection.anchorOffset).toBe(text.length)
    expect(selection.focusOffset).toBe(1)
  })

  it('ignores selections outside the layer the drag started in', () => {
    const { layer } = lineLayer()
    const other = makeLayer()
    const otherText = other.querySelector('span')!.firstChild as Text
    const selection = select(otherText, 1, otherText, otherText.length)
    snapSelectionStart({ layer, x: 94, y: 60 }, selection)
    expect(selection.anchorOffset).toBe(1)
  })

  it('uses the whole line span when the anchor sits inside a citation marker', () => {
    const { layer, span } = lineLayer(true)
    const buttonText = span.querySelector('button')!.firstChild as Text
    const selection = select(buttonText, 1, buttonText, buttonText.length)
    // The drag began left of the line, not left of the citation button.
    snapSelectionStart({ layer, x: 94, y: 60 }, selection)
    expect(selection.toString()).toBe('See [1] for details')
  })
})
