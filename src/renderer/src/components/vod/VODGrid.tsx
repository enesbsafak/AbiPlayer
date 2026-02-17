import { useRef, useMemo, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { VODCard } from './VODCard'
import type { Channel } from '@/types/playlist'

interface VODGridProps {
  items: Channel[]
  onPlay: (item: Channel) => void
}

const NON_VIRTUAL_ITEM_THRESHOLD = 80
const GRID_GAP = 16
const ROW_GAP = 16
const VOD_MIN_CARD_WIDTH = 168
const VOD_MAX_COLS = 9

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let current = el?.parentElement ?? null
  while (current) {
    const style = window.getComputedStyle(current)
    const overflowY = style.overflowY || style.overflow
    if (overflowY.includes('auto') || overflowY.includes('scroll')) return current
    current = current.parentElement
  }
  return null
}

function getColumns(containerWidth: number): number {
  const rawCols = Math.floor((containerWidth + GRID_GAP) / (VOD_MIN_CARD_WIDTH + GRID_GAP))
  return Math.max(2, Math.min(VOD_MAX_COLS, rawCols || 1))
}

export function VODGrid({ items, onPlay }: VODGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : Math.max(360, window.innerWidth)
  )
  const [cols, setCols] = useState(() => getColumns(containerWidth))
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const element = parentRef.current
    if (!element) return

    let rafId = 0

    const syncLayout = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const width = Math.max(320, Math.round(element.getBoundingClientRect().width))
        setContainerWidth((prev) => (prev === width ? prev : width))
        setCols((prev) => {
          const next = getColumns(width)
          return prev === next ? prev : next
        })
        setScrollElement(findScrollParent(element))
      })
    }

    const observer = new ResizeObserver(syncLayout)
    observer.observe(element)
    window.addEventListener('resize', syncLayout)
    syncLayout()

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      window.removeEventListener('resize', syncLayout)
    }
  }, [])

  const rows = useMemo(() => {
    const result: Channel[][] = []
    for (let i = 0; i < items.length; i += cols) {
      result.push(items.slice(i, i + cols))
    }
    return result
  }, [items, cols])

  const estimatedRowSize = useMemo(() => {
    const width = Math.max(320, containerWidth)
    const totalGap = GRID_GAP * (cols - 1)
    const cardWidth = Math.max(120, (width - totalGap) / cols)
    const cardHeight = cardWidth * 1.5
    return Math.round(cardHeight + 72 + ROW_GAP)
  }, [containerWidth, cols])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimatedRowSize,
    overscan: 4
  })

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-surface-400">
        <p className="text-lg">Icerik bulunamadi</p>
      </div>
    )
  }

  if (items.length <= NON_VIRTUAL_ITEM_THRESHOLD) {
    return (
      <div ref={parentRef}>
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {items.map((item) => (
            <VODCard key={item.id} item={item} onPlay={onPlay} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={parentRef}>
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="absolute left-0 top-0 w-full"
            style={{
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`
            }}
          >
            <div className="grid gap-4 pb-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {(rows[virtualRow.index] ?? []).map((item) => (
                <VODCard key={item.id} item={item} onPlay={onPlay} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
