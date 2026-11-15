import { useCallback, type KeyboardEvent } from 'react'
import { isTextEntryTarget } from '@/hooks/useKeyboard'

export type Direction = 'left' | 'right' | 'up' | 'down'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down'
}

/**
 * The index of the box to move to from `from` in `direction`, or null when
 * there is none that way. Only boxes whose centre lies in that direction
 * count; the nearest wins, with drift across the direction weighed double so
 * that a tile straight ahead beats a closer one off to the side.
 */
export function pickInDirection(from: Box, boxes: readonly Box[], direction: Direction): number | null {
  const fx = from.left + from.width / 2
  const fy = from.top + from.height / 2
  let best: number | null = null
  let bestScore = Number.POSITIVE_INFINITY
  boxes.forEach((box, index) => {
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const dx = x - fx
    const dy = y - fy
    let along: number
    let across: number
    switch (direction) {
      case 'right':
        along = dx
        across = Math.abs(dy)
        break
      case 'left':
        along = -dx
        across = Math.abs(dy)
        break
      case 'down':
        along = dy
        across = Math.abs(dx)
        break
      case 'up':
        along = -dy
        across = Math.abs(dx)
        break
    }
    if (along <= 1) return
    const score = along + across * 2
    if (score < bestScore) {
      bestScore = score
      best = index
    }
  })
  return best
}

/** Marks the controls the home screen's arrow keys move between. */
export const SPATIAL_ATTRIBUTE = 'data-spatial-focus'

/**
 * Arrow keys move focus between the marked controls inside the element the
 * handler is attached to, by where they are on screen: the home screen is a
 * grid of tiles, not a list, and Tab alone walks it in reading order only.
 * Text fields keep their arrows.
 */
export function useSpatialArrowKeys() {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    const direction = ARROWS[event.key]
    if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (isTextEntryTarget(event.target)) return
    const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(`[${SPATIAL_ATTRIBUTE}]`) : null
    if (!current) return
    const candidates = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[${SPATIAL_ATTRIBUTE}]`)).filter(
      (element) => element !== current && element.getClientRects().length > 0
    )
    const toBox = (element: HTMLElement): Box => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
    const index = pickInDirection(toBox(current), candidates.map(toBox), direction)
    if (index === null) return
    event.preventDefault()
    candidates[index]?.focus()
  }, [])
}
