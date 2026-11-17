import { useEffect, useRef } from 'react'

/** How close to the end of the scrolled content counts as near: this many viewport heights. */
export const NEAR_END_VIEWPORTS = 1.5

export interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/**
 * Whether the viewport is within `viewports` of its heights from the end of
 * the content. A list too short to scroll is always near its end.
 */
export function isNearEnd(metrics: ScrollMetrics, viewports = NEAR_END_VIEWPORTS): boolean {
  const remaining = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
  return remaining <= Math.max(1, metrics.clientHeight) * viewports
}

/**
 * Calls `onNearEnd` while `enabled` and the scroll element is near the end
 * of its content: on scroll (wheel, keys moving the focus down the grid),
 * on a resize, and after every render that changes `contentKey` (a page
 * arrived but still does not fill the view).
 */
export function useNearEnd(
  element: HTMLElement | null,
  enabled: boolean,
  onNearEnd: () => void,
  contentKey: unknown
): void {
  const callbackRef = useRef(onNearEnd)
  useEffect(() => {
    callbackRef.current = onNearEnd
  })

  useEffect(() => {
    if (!element || !enabled) return
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (isNearEnd(element)) callbackRef.current()
      })
    }
    check()
    element.addEventListener('scroll', check, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check)
    observer?.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('scroll', check)
      observer?.disconnect()
    }
  }, [element, enabled, contentKey])
}
