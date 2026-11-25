// Drag selection that starts in blank page space must not jump to unrelated
// text. pdf.js's core `TextLayer` only positions spans; its viewer's
// TextLayerBuilder adds the guard this ports. An `.endOfContent` element sits
// after the text. While a selection is being made (`data-selecting`), CSS
// stretches it over the whole layer below the spans, so a drag that begins
// beside a line hits the guard rather than letting Chromium snap the
// selection to the next text in DOM order (for example the author block
// under a title). Chromium still anchors such a drag one character into the
// line, so a drag that starts in blank space left of a line snaps its start
// to the line's first character, and a drag released right of a line snaps
// its end to the line's last character. Global listeners are shared by all
// bound layers.
//
// TextLayerBuilder also moves the guard next to the selection's moving end on
// each selectionchange, but only for Chromium before 148. Electron 45 ships
// Chromium 156, which pdf.js 6.2 treats as modern and skips, so that half is
// not ported.

const layers = new Map<HTMLElement, HTMLElement>()
let globalListeners: AbortController | null = null
type DragStart = { layer: HTMLElement; x: number; y: number }

// Where the current primary-button drag started. Cleared when a new press
// starts or the window loses focus, so a drag that ended outside the window
// cannot leave a stale start behind.
let blankStart: DragStart | null = null

/** First text node inside `element`, in document order. */
function firstTextNode(element: Element): Text | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

/** Last text node inside `element`, in document order. */
function lastTextNode(element: Element): Text | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text
  return last
}

/** The layer's direct child that contains `node`: one positioned line box. */
function lineSpan(layer: HTMLElement, node: Node): HTMLElement | null {
  let span = node.parentElement
  while (span && span.parentElement !== layer) span = span.parentElement
  return span
}

/** The line the drag started beside: of the layer's spans on the start's
 * line whose left edge lies at or right of it, the leftmost. pdf.js often
 * splits one visual line into several spans, and in a two-column page the
 * nearest line to the right is the one in the column the drag began in. */
function lineStartSpan(start: DragStart): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestLeft = Infinity
  for (const child of start.layer.children) {
    if (!(child instanceof HTMLElement) || child.tagName !== 'SPAN') continue
    // pdf.js turns rotated text (an arXiv margin stamp, a sideways table)
    // with --rotate. Its bounding box is a tall rectangle that would match
    // almost any start, so it never counts as a line here.
    const rotate = child.style.getPropertyValue('--rotate').trim()
    if (rotate !== '' && parseFloat(rotate) !== 0) continue
    const rect = child.getBoundingClientRect()
    if (start.y < rect.top || start.y > rect.bottom) continue
    // The drag began inside text, where Chromium's anchor is already right.
    if (rect.left < start.x - 1 && rect.right > start.x) return null
    if (rect.left < start.x - 1) continue
    if (rect.left < bestLeft) {
      best = child
      bestLeft = rect.left
    }
  }
  return best
}

/**
 * After a forward drag that began at or left of a line's first glyph, move
 * the selection's start to the beginning of that line. The span is the
 * layer's direct child, so a citation marker wrapped inside it (readerText.ts)
 * does not change which box counts as the line. Chromium anchors such a drag
 * one character into the line, at its end, or at the start of the next line;
 * at the line's end, a drag released on the same line even leaves a collapsed
 * selection. Callers only call this after the pointer moved, so a plain click
 * never selects anything. Exported for tests.
 */
export function snapSelectionStart(
  start: DragStart | null,
  selection: Selection | null,
  releaseX?: number,
): void {
  if (!start || !selection || selection.rangeCount !== 1) return
  const anchor = selection.anchorNode
  const focusNode = selection.focusNode
  if (!anchor || !focusNode || !start.layer.contains(anchor)) return
  const range = selection.getRangeAt(0)
  // Only forward selections (anchor at the range start) are adjusted, and
  // only when the focus is not before the line (an upward drag). Checked
  // before the geometry scan, which reads every span's box.
  if (range.startContainer !== anchor || range.startOffset !== selection.anchorOffset) return
  const line = lineStartSpan(start)
  const first = line && firstTextNode(line)
  if (!line || !first || (anchor === first && selection.anchorOffset === 0)) return
  // A collapsed selection only becomes the line when the pointer was
  // released over it; a drag that stayed in the margin selects nothing.
  if (selection.isCollapsed && releaseX !== undefined && releaseX < line.getBoundingClientRect().left - 1) return
  const lineStart = document.createRange()
  lineStart.setStart(first, 0)
  if (lineStart.comparePoint(focusNode, selection.focusOffset) < 0) return
  selection.setBaseAndExtent(first, 0, focusNode, selection.focusOffset)
}

/**
 * After a forward drag released at or right of a line's last glyph, move the
 * selection's end to the end of that line's span. Over the guard Chromium
 * places the focus one character short, so a drag past the end of a title
 * dropped its last letter. Exported for tests.
 */
export function snapSelectionEnd(end: DragStart | null, selection: Selection | null): void {
  if (!end || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return
  const focus = selection.focusNode
  if (!focus || focus.nodeType !== Node.TEXT_NODE || !end.layer.contains(focus)) return
  const span = lineSpan(end.layer, focus)
  if (!span) return
  const last = lastTextNode(span)
  if (!last || (focus === last && selection.focusOffset === last.length)) return
  const rect = span.getBoundingClientRect()
  const sameLine = end.y >= rect.top && end.y <= rect.bottom
  if (!sameLine || end.x < rect.right - 1) return
  const range = selection.getRangeAt(0)
  // Only forward selections (focus at the range end) are adjusted.
  if (range.endContainer !== focus || range.endOffset !== selection.focusOffset) return
  const anchor = selection.anchorNode
  if (!anchor) return
  selection.setBaseAndExtent(anchor, selection.anchorOffset, last, last.length)
}

// Pointer travel below this many pixels is a click, not a drag.
const DRAG_THRESHOLD_PX = 3

function snapDragEnds(event: MouseEvent): void {
  const start = blankStart
  blankStart = null
  if (!start || event.button !== 0) return
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return
  snapSelectionStart(start, document.getSelection(), event.clientX)
  snapSelectionEnd({ layer: start.layer, x: event.clientX, y: event.clientY }, document.getSelection())
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

  // Runs before a layer's mousedown records the new start.
  document.addEventListener('pointerdown', () => {
    pointerDown = true
    blankStart = null
  }, { signal })
  document.addEventListener('pointerup', () => {
    pointerDown = false
    resetAll()
  }, { signal })
  // Capture phase: fix the range before the Reader's own mouseup handler
  // reads it for the selection toolbar and Add to chat.
  document.addEventListener('mouseup', snapDragEnds, { capture: true, signal })
  window.addEventListener('blur', () => {
    pointerDown = false
    blankStart = null
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
  // A second guard would be orphaned at full height after either unbind.
  if (layers.has(layer)) throw new Error('bindTextLayerSelection: layer is already bound')
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)
  const onMouseDown = (event: MouseEvent) => {
    layer.setAttribute('data-selecting', '')
    // Record every primary-button start; snapDragEnds only acts when the
    // start lies left of the selected line or the release lies right of it.
    // Shift+press extends an existing selection, whose anchor is the user's
    // earlier choice; snapping it to this line would shrink the selection.
    blankStart = event.button === 0 && !event.shiftKey ? { layer, x: event.clientX, y: event.clientY } : null
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
