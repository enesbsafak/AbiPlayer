import { useEffect, useState } from 'react'

/**
 * Where the experimental corner player (plan F2-15) sits: a 16:9 rectangle in
 * the bottom-right corner of the window, a quarter of its width within limits.
 */

export interface CornerRect {
  left: number
  top: number
  width: number
  height: number
}

export const CORNER_GAP_PX = 16
export const CORNER_MIN_WIDTH_PX = 288
export const CORNER_MAX_WIDTH_PX = 480

export function cornerPlayerRect(viewport: { width: number; height: number }): CornerRect {
  const available = Math.max(0, viewport.width - 2 * CORNER_GAP_PX)
  const width = Math.min(
    available,
    Math.max(CORNER_MIN_WIDTH_PX, Math.min(CORNER_MAX_WIDTH_PX, Math.round(viewport.width / 4)))
  )
  const height = Math.round((width * 9) / 16)
  return {
    left: Math.max(0, viewport.width - CORNER_GAP_PX - width),
    top: Math.max(0, viewport.height - CORNER_GAP_PX - height),
    width,
    height
  }
}

function viewportRect(): CornerRect {
  return cornerPlayerRect({ width: window.innerWidth, height: window.innerHeight })
}

function sameRect(a: CornerRect, b: CornerRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

/** The corner rectangle for the current window size; followed only while `active`. */
export function useCornerRect(active: boolean): CornerRect {
  const [rect, setRect] = useState(viewportRect)
  useEffect(() => {
    if (!active) return
    const update = () => {
      const next = viewportRect()
      setRect((previous) => (sameRect(previous, next) ? previous : next))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [active])
  return rect
}

/**
 * A clip-path that keeps everything except `rect`: the page stays opaque
 * around the corner player and transparent inside it, where the mpv surface
 * behind the window's transparent page shows through.
 */
export function clipPathOutside(rect: CornerRect): string {
  const l = `${rect.left}px`
  const t = `${rect.top}px`
  const r = `${rect.left + rect.width}px`
  const b = `${rect.top + rect.height}px`
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${r} ${t}, ${r} ${b}, ${l} ${b}, ${l} ${t})`
}
