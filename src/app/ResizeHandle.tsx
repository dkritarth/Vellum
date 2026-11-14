// Draggable divider between a side panel and the center pane. Pointer drag
// resizes, arrow keys nudge, Home/double-click reset to the default width.
// Dragging well past the minimum collapses the panel.

import { useEffect, useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

import { PANEL_LIMITS, type PanelSide } from './panelLayout'
import styles from './ResizeHandle.module.css'

const KEY_STEP = 16
const COLLAPSE_OVERSHOOT = 80

interface ResizeHandleProps {
  side: PanelSide
  width: number
  onResize: (width: number) => void
  onReset: () => void
  onCollapse: () => void
}

export function ResizeHandle({ side, width, onResize, onReset, onCollapse }: ResizeHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const limits = PANEL_LIMITS[side]
  // Moving right widens the left panel and narrows the right panel.
  const direction = side === 'left' ? 1 : -1
  const label = side === 'left' ? 'Resize sidebar' : 'Resize paper panel'

  useEffect(() => () => {
    if (drag.current) delete document.body.dataset.resizing
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width }
    document.body.dataset.resizing = 'true'
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const next = drag.current.startWidth + (event.clientX - drag.current.startX) * direction
    if (next < limits.min - COLLAPSE_OVERSHOOT) {
      endDrag(event)
      onCollapse()
      return
    }
    onResize(next)
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    drag.current = null
    delete document.body.dataset.resizing
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const sign = event.key === 'ArrowRight' ? 1 : -1
      onResize(width + sign * direction * KEY_STEP)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onReset()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onCollapse()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      title={`${label}. Drag to resize, double-click to reset.`}
      className={styles.handle}
      data-side={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
