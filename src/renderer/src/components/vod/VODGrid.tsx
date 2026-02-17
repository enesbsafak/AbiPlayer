import { useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { VODCard } from './VODCard'
import type { Channel } from '@/types/playlist'

interface VODGridProps {
  items: Channel[]
  onPlay: (item: Channel) => void
}

function useColumns(): number {
  if (typeof window === 'undefined') return 4
  const w = window.innerWidth
  if (w < 640) return 2
  if (w < 768) return 3
  if (w < 1024) return 4
  if (w < 1280) return 5
  return 6
}

export function VODGrid({ items, onPlay }: VODGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const cols = useColumns()

  const rows = useMemo(() => {
    const result: Channel[][] = []
    for (let i = 0; i < items.length; i += cols) {
      result.push(items.slice(i, i + cols))
    }
    return result
  }, [items, cols])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current?.parentElement ?? null,
    estimateSize: () => 320,
    overscan: 3
  })

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-surface-500">
        <p className="text-lg">No content found</p>
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
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {rows[virtualRow.index].map((item) => (
                <VODCard key={item.id} item={item} onPlay={onPlay} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
