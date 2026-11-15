import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import { nextGridIndex } from './grid-keyboard'

/** On the focusable element of each item: its index. */
export const ROVING_INDEX_ATTR = 'data-roving-index'
/** On the element wrapping each item (the item and its secondary controls). */
export const ROVING_CELL_ATTR = 'data-roving-cell'

function readIndex(target: EventTarget | null, attribute: string): number | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest(`[${attribute}]`)
  if (!cell) return null
  const value = Number(cell.getAttribute(attribute))
  return Number.isInteger(value) && value >= 0 ? value : null
}

export interface RovingFocusOptions {
  count: number
  columns: number
  /** Rows a PageUp / PageDown moves. */
  pageRows: number
  /** Brings an index into the rendered range (scrolls a virtualized list to it). */
  reveal: (index: number) => void
}

export interface RovingFocus {
  /** The index holding the tab stop; clamped to the list. */
  activeIndex: number
  /** Moves the tab stop and the focus to `index`, scrolling it into the rendered range first if needed. */
  focusIndex: (index: number) => void
  /** Spread on the element containing every item. */
  containerProps: {
    tabIndex: -1
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
    onFocus: (event: FocusEvent<HTMLElement>) => void
    onBlur: (event: FocusEvent<HTMLElement>) => void
  }
}

/**
 * Roving tabindex for a (possibly virtualized) grid or list: one tab stop, the
 * arrow keys move it. An item that is not rendered is scrolled to first and
 * focused once it mounts. When the focused item scrolls out and unmounts, the
 * focus falls back to the container instead of the page body, so the next
 * arrow key brings the active item back rather than doing nothing.
 */
export function useRovingFocus(containerRef: RefObject<HTMLElement | null>, options: RovingFocusOptions): RovingFocus {
  const { count, columns, pageRows, reveal } = options
  const [rawActiveIndex, setActiveIndex] = useState(0)
  const activeIndex = count > 0 ? Math.min(rawActiveIndex, count - 1) : 0
  const pendingFocusRef = useRef<number | null>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  const elementAt = useCallback(
    (index: number) => containerRef.current?.querySelector<HTMLElement>(`[${ROVING_INDEX_ATTR}="${index}"]`) ?? null,
    [containerRef]
  )

  const focusIndex = useCallback(
    (index: number) => {
      if (count <= 0) return
      const target = Math.max(0, Math.min(count - 1, index))
      setActiveIndex(target)
      const element = elementAt(target)
      if (element) {
        pendingFocusRef.current = null
        element.focus()
        return
      }
      pendingFocusRef.current = target
      reveal(target)
    },
    [count, elementAt, reveal]
  )

  // Runs after every render: the list re-renders whenever its rendered range
  // changes, which is when a pending item mounts or a focused one unmounts.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (pending !== null) {
      const element = elementAt(pending)
      if (element) {
        pendingFocusRef.current = null
        element.focus()
        return
      }
    }
    const last = lastFocusedRef.current
    if (last && !last.isConnected) {
      lastFocusedRef.current = null
      const active = document.activeElement
      if (!active || active === document.body) containerRef.current?.focus({ preventScroll: true })
    }
  })

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const fromContainer = event.target === containerRef.current
      const current = fromContainer ? activeIndex : readIndex(event.target, ROVING_CELL_ATTR)
      if (current === null) return
      const next = nextGridIndex(current, event, { count, columns, pageRows })
      if (next === null) return
      event.preventDefault()
      // From the container (after the focused item scrolled away) the first
      // key brings the active item back instead of moving past it.
      focusIndex(fromContainer ? activeIndex : next)
    },
    [activeIndex, columns, containerRef, count, focusIndex, pageRows]
  )

  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const index = readIndex(event.target, ROVING_INDEX_ATTR)
    if (index === null) return
    lastFocusedRef.current = event.target as HTMLElement
    setActiveIndex(index)
  }, [])

  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget
      // Focus moved somewhere else on purpose; an unmount has no related target.
      if (next instanceof Node && !containerRef.current?.contains(next)) lastFocusedRef.current = null
    },
    [containerRef]
  )

  return { activeIndex, focusIndex, containerProps: { tabIndex: -1, onKeyDown, onFocus, onBlur } }
}
