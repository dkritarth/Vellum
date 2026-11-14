// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResizeHandle } from './ResizeHandle'

afterEach(() => { cleanup(); delete document.body.dataset.resizing; vi.unstubAllGlobals() })

describe('ResizeHandle drag lifecycle', () => {
  function startDrag() {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const view = render(<ResizeHandle side="left" width={220} onResize={vi.fn()} onReset={vi.fn()} onCollapse={vi.fn()} />)
    const handle = screen.getByRole('separator')
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => false)
    fireEvent.pointerDown(handle, { button: 0, clientX: 220 })
    expect(document.body).toHaveAttribute('data-resizing', 'true')
    return { ...view, handle }
  }

  it('restores text selection when the dragged panel is collapsed', () => {
    const { unmount } = startDrag()
    unmount()
    expect(document.body).not.toHaveAttribute('data-resizing')
  })

  it('restores text selection when pointer capture is lost', () => {
    const { handle } = startDrag()
    fireEvent.lostPointerCapture(handle)
    expect(document.body).not.toHaveAttribute('data-resizing')
  })
})
