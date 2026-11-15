import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { findScrollRoot } from '@/services/scroll-root'
import type { Channel } from '@/types/playlist'
import { gridColumns } from './grid-keyboard'
import { ROVING_INDEX_ATTR, useRovingFocus } from './useRovingFocus'

export interface CardGridLayout {
  minCardWidth: number
  maxColumns: number
  /** Gap between cards in px; must match `gapClass`. */
  gap: number
  /** Tailwind classes for the same gap between columns and below each row. */
  gapClass: string
  rowGapClass: string
  /** Height of one card for a card width, used until the row is measured. */
  estimateCardHeight: (cardWidth: number) => number
  /** Lists up to this length render without virtualization. */
  virtualizeAbove: number
  /** Fewest columns, however narrow (default 2; 1 for a list of rows). */
  minColumns?: number
}

export interface CardRenderProps<T> {
  item: T
  index: number
  eagerImage: boolean
  /** Spread on the card's main control: roving tab stop and its index. */
  focusProps: { tabIndex: number; [ROVING_INDEX_ATTR]: number }
  /** tabIndex for the card's other controls (the favourite star). */
  secondaryTabIndex: number
  onOpen: (item: T) => void
}

export interface VirtualCardGridHandle {
  /** Focuses the card of `id`, scrolling it into view first; false when it is not in the list. */
  focusItem: (id: string) => boolean
}

interface VirtualCardGridProps<T extends Channel> {
  items: readonly T[]
  layout: CardGridLayout
  renderCard: (props: CardRenderProps<T>) => ReactNode
  onOpen: (item: T) => void
  /** The element that scrolls the grid; omitted: the nearest scrolling ancestor. */
  scrollElement?: HTMLElement | null
  ariaLabel: string
  empty?: ReactNode
  handleRef?: Ref<VirtualCardGridHandle>
}

const MIN_WIDTH = 320
/** How far past the viewport's edge a row may measure and still count as in view, px. */
const EDGE_SLACK = 8

function initialWidth(): number {
  return typeof window === 'undefined' ? 1280 : Math.max(360, window.innerWidth)
}

/**
 * The one card grid of the app: rows of cards that fill the width, virtualized
 * by row above `virtualizeAbove` items, rows measured after they render (two
 * line titles no longer overflow into the next row), and keyboard navigation
 * with a roving tab stop that works across virtualized rows.
 */
export function VirtualCardGrid<T extends Channel>({
  items,
  layout,
  renderCard,
  onOpen,
  scrollElement,
  ariaLabel,
  empty,
  handleRef
}: VirtualCardGridProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(initialWidth)
  const [foundScrollRoot, setFoundScrollRoot] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const scrollRoot = scrollElement === undefined ? foundScrollRoot : scrollElement
  const columns = gridColumns(width, layout)
  const rowCount = Math.ceil(items.length / columns)
  const virtualized = items.length > layout.virtualizeAbove

  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      if (!node) return
      setWidth(Math.max(MIN_WIDTH, Math.round(node.getBoundingClientRect().width)))
      if (scrollElement === undefined) setFoundScrollRoot(findScrollRoot(node))
    },
    [scrollElement]
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = Math.max(MIN_WIDTH, Math.round(element.getBoundingClientRect().width))
        setWidth((previous) => (previous === next ? previous : next))
      })
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  // Where the grid starts inside its scroll element: padding and headings
  // above it move it down, and the virtualizer needs that offset to compute
  // which rows are on screen and where to scroll for a row.
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element || !scrollRoot) return
    const offset = Math.round(
      element.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop
    )
    setScrollMargin((previous) => (previous === offset ? previous : offset))
  }, [scrollRoot, items, width])

  const estimatedRowSize = useMemo(() => {
    const cardWidth = Math.max(120, (Math.max(MIN_WIDTH, width) - layout.gap * (columns - 1)) / columns)
    return Math.round(layout.estimateCardHeight(cardWidth) + layout.gap)
  }, [width, columns, layout])

  // A row is its first card plus the column count: a new key after a reflow
  // or a different list is measured again instead of reusing the height of
  // whatever row had that index before. Stable between renders: a new
  // function makes the virtualizer recompute every row's position, which
  // with 100,000 films is 30,000 rows per scrolled frame.
  const getItemKey = useCallback((row: number) => `${columns}:${items[row * columns]?.id ?? row}`, [columns, items])

  const virtualizer = useVirtualizer({
    count: virtualized ? rowCount : 0,
    getScrollElement: () => scrollRoot,
    estimateSize: () => estimatedRowSize,
    getItemKey,
    scrollMargin,
    overscan: 3
  })
  const virtualRows = virtualized ? virtualizer.getVirtualItems() : []

  const reveal = useCallback(
    (index: number) => {
      if (!virtualized) return
      const row = Math.floor(index / columns)
      // Just scrolled there (a restored position) but the virtualizer has not
      // seen the scroll event yet: the row renders with it, so scrolling again
      // would only move the page away from where it was restored to.
      const measured = virtualizer.measurementsCache[row]
      if (measured && scrollRoot) {
        const top = scrollRoot.scrollTop
        const bottom = top + scrollRoot.clientHeight
        // The cards, without the gap under them.
        const cardsEnd = measured.end - layout.gap
        // A row lying on the viewport's edge, as rows of a remounted page
        // measure a few pixels from where they were, is in view.
        if (measured.start >= top - EDGE_SLACK && cardsEnd <= bottom + EDGE_SLACK) return
        // Otherwise scroll from where the page really is. The virtualizer's
        // own scrollToIndex works from the offset of the last scroll event it
        // saw, which after a restore can still be 0: it took a row at the top
        // edge for one below the viewport and moved the page a screen up.
        scrollRoot.scrollTop = measured.start < top ? measured.start : cardsEnd - scrollRoot.clientHeight
        return
      }
      virtualizer.scrollToIndex(row, { align: 'auto' })
    },
    [virtualized, virtualizer, columns, scrollRoot, layout.gap]
  )
  const pageRows = Math.max(1, Math.floor((scrollRoot?.clientHeight ?? estimatedRowSize) / estimatedRowSize))
  const roving = useRovingFocus(containerRef, { count: items.length, columns, pageRows, reveal })
  const { activeIndex, focusIndex } = roving

  useImperativeHandle(
    handleRef,
    () => ({
      focusItem: (id: string) => {
        const index = items.findIndex((item) => item.id === id)
        if (index < 0) return false
        focusIndex(index)
        return true
      }
    }),
    [items, focusIndex]
  )

  if (items.length === 0) return <>{empty ?? null}</>

  // The tab stop sits on the active card while it is rendered, otherwise on
  // the first rendered one, so Tab always enters the grid where the user sees it.
  const firstRendered = virtualized ? (virtualRows[0]?.index ?? 0) * columns : 0
  const lastRendered = virtualized
    ? Math.min(items.length, ((virtualRows[virtualRows.length - 1]?.index ?? 0) + 1) * columns) - 1
    : items.length - 1
  const tabStop = activeIndex >= firstRendered && activeIndex <= lastRendered ? activeIndex : firstRendered

  const cell = (item: T, index: number) => (
    // A one-cell grid, so the card fills the row height like a direct grid child.
    <div key={item.id} data-roving-cell={index} className="grid min-w-0">
      {renderCard({
        item,
        index,
        eagerImage: index < columns * 2,
        focusProps: { tabIndex: index === tabStop ? 0 : -1, [ROVING_INDEX_ATTR]: index },
        secondaryTabIndex: index === tabStop ? 0 : -1,
        onOpen
      })}
    </div>
  )
  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }

  return (
    <div
      ref={setContainer}
      role="group"
      aria-label={ariaLabel}
      className="rounded-card outline-none focus-visible:ring-2 focus-visible:ring-sun/60"
      {...roving.containerProps}
    >
      {virtualized ? (
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualRows.map((row) => {
            const start = row.index * columns
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
              >
                <div className={`grid ${layout.gapClass} ${layout.rowGapClass}`} style={gridStyle}>
                  {items.slice(start, start + columns).map((item, offset) => cell(item, start + offset))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className={`grid ${layout.gapClass}`} style={gridStyle}>
          {items.map((item, index) => cell(item, index))}
        </div>
      )}
    </div>
  )
}
