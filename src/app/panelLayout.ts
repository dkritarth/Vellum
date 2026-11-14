// Side-panel layout: widths and collapsed state for the left sidebar and the
// right paper panel. Pure helpers plus a hook that persists the layout in
// localStorage so it survives restarts (#212).

import { useCallback, useEffect, useState } from 'react'

export type PanelSide = 'left' | 'right'

export interface PanelLayout {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
}

export const PANEL_LIMITS: Record<PanelSide, { min: number; max: number; default: number }> = {
  left: { min: 160, max: 420, default: 220 },
  right: { min: 280, max: 760, default: 360 },
}

export const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: PANEL_LIMITS.left.default,
  rightWidth: PANEL_LIMITS.right.default,
  leftCollapsed: false,
  rightCollapsed: false,
}

export const LAYOUT_STORAGE_KEY = 'vellum.panelLayout.v1'

export function clampWidth(side: PanelSide, width: number): number {
  const { min, max, default: fallback } = PANEL_LIMITS[side]
  if (!Number.isFinite(width)) return fallback
  return Math.round(Math.min(max, Math.max(min, width)))
}

/** Parse a stored layout, falling back field by field on anything invalid. */
export function parseLayout(raw: string | null): PanelLayout {
  if (!raw) return DEFAULT_LAYOUT
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULT_LAYOUT
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT
  const v = value as Record<string, unknown>
  return {
    leftWidth: typeof v.leftWidth === 'number' ? clampWidth('left', v.leftWidth) : DEFAULT_LAYOUT.leftWidth,
    rightWidth: typeof v.rightWidth === 'number' ? clampWidth('right', v.rightWidth) : DEFAULT_LAYOUT.rightWidth,
    leftCollapsed: v.leftCollapsed === true,
    rightCollapsed: v.rightCollapsed === true,
  }
}

function readStoredLayout(): PanelLayout {
  try {
    return parseLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY))
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function usePanelLayout() {
  const [layout, setLayout] = useState<PanelLayout>(readStoredLayout)

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Storage unavailable: the layout still works for this session.
    }
  }, [layout])

  const setWidth = useCallback((side: PanelSide, width: number) => {
    setLayout((current) => ({ ...current, [side === 'left' ? 'leftWidth' : 'rightWidth']: clampWidth(side, width) }))
  }, [])

  const resetWidth = useCallback((side: PanelSide) => {
    setLayout((current) => ({ ...current, [side === 'left' ? 'leftWidth' : 'rightWidth']: PANEL_LIMITS[side].default }))
  }, [])

  const setCollapsed = useCallback((side: PanelSide, collapsed: boolean) => {
    setLayout((current) => ({ ...current, [side === 'left' ? 'leftCollapsed' : 'rightCollapsed']: collapsed }))
  }, [])

  const toggle = useCallback((side: PanelSide) => {
    setLayout((current) => side === 'left'
      ? { ...current, leftCollapsed: !current.leftCollapsed }
      : { ...current, rightCollapsed: !current.rightCollapsed })
  }, [])

  return { layout, setWidth, resetWidth, setCollapsed, toggle }
}
