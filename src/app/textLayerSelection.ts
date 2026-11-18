// Drag selection that starts in blank page space must not jump to unrelated
// text. pdf.js's core `TextLayer` only positions spans; its viewer's
// TextLayerBuilder adds the guard this ports. An `.endOfContent` element sits
// after the text. While a selection is being made (`data-selecting`), CSS
// stretches it over the whole layer below the spans, so a drag that begins
// beside a line hits the guard rather than letting Chromium snap the
// selection to the next text in DOM order (for example the author block
// under a title). Chromium still anchors such a drag one character into the
// line, so a drag that starts in blank space left of a line snaps its start
// to the line's first character. Global listeners are shared by all bound
// layers.

const layers = new Map<HTMLElement, HTMLElement>()
let globalListeners: AbortController | null = null
// Where the current primary-button drag started.
let blankStart: { layer: HTMLElement; x: number; y: number } | null = null

// After a forward drag that began at or left of a line's first glyph, move the selection's start
// to the beginning of the span on that line.
function snapBlankStart(): void {
  const start = blankStart
  blankStart = null
  const selection = document.getSelection()
  if (!start || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return
  const anchor = selection.anchorNode
  const span = anchor?.parentElement
  if (!anchor || anchor.nodeType !== Node.TEXT_NODE || !span || span === start.layer || !start.layer.contains(span)) return
  if (selection.anchorOffset === 0) return
  const rect = span.getBoundingClientRect()
  const sameLine = start.y >= rect.top && start.y <= rect.bottom
  if (!sameLine || start.x > rect.left + 1) return
  const range = selection.getRangeAt(0)
  // Only forward selections (anchor at the range start) are adjusted.
  if (range.startContainer !== anchor || range.startOffset !== selection.anchorOffset) return
  const focusNode = selection.focusNode
  if (!focusNode) return
  selection.setBaseAndExtent(anchor, 0, focusNode, selection.focusOffset)
}

function reset(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end)
  layer.removeAttribute('data-selecting')
}

function enableGlobalListeners(): void {
  if (globalListeners) return
  globalListeners = new AbortController()
  const { signal } = globalListeners
  let pointerDown = false
  const resetAll = () => layers.forEach(reset)

  document.addEventListener('pointerdown', () => { pointerDown = true }, { signal })
  document.addEventListener('pointerup', () => {
    pointerDown = false
    resetAll()
  }, { signal })
  // Capture phase: fix the range before the Reader's own mouseup handler
  // reads it for the selection toolbar and Add to chat.
  document.addEventListener('mouseup', snapBlankStart, { capture: true, signal })
  window.addEventListener('blur', () => {
    pointerDown = false
    resetAll()
  }, { signal })
  document.addEventListener('keyup', () => {
    if (!pointerDown) resetAll()
  }, { signal })
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) {
      resetAll()
      return
    }
    const active = new Set<HTMLElement>()
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i)
      for (const layer of layers.keys()) {
        if (range.intersectsNode(layer)) active.add(layer)
      }
    }
    for (const [layer, end] of layers) {
      if (active.has(layer)) layer.setAttribute('data-selecting', '')
      else reset(end, layer)
    }
  }, { signal })
}

export function bindTextLayerSelection(layer: HTMLElement): () => void {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)
  const onMouseDown = (event: MouseEvent) => {
    layer.setAttribute('data-selecting', '')
    // Record every primary-button start; snapBlankStart only acts when the
    // start lies at or left of the selected line's first glyph.
    blankStart = event.button === 0 ? { layer, x: event.clientX, y: event.clientY } : null
  }
  layer.addEventListener('mousedown', onMouseDown)
  layers.set(layer, end)
  enableGlobalListeners()

  return () => {
    layer.removeEventListener('mousedown', onMouseDown)
    layer.removeAttribute('data-selecting')
    end.remove()
    layers.delete(layer)
    if (layers.size === 0) {
      globalListeners?.abort()
      globalListeners = null
    }
  }
}
