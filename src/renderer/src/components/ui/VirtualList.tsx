import { useRef, type ComponentType } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

interface VirtualListItemProps<T> {
  item: T
  index: number
}

interface VirtualListProps<T> {
  items: T[]
  estimateSize: number
  itemComponent: ComponentType<VirtualListItemProps<T>>
  className?: string
  overscan?: number
}

export function VirtualList<T>({ items, estimateSize, itemComponent: ItemComponent, className = '', overscan = 5 }: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan
  })

  return (
    <div ref={parentRef} className={`overflow-auto ${className}`}>
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            className="absolute left-0 top-0 w-full"
            style={{
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`
            }}
          >
            <ItemComponent item={items[virtualItem.index]} index={virtualItem.index} />
          </div>
        ))}
      </div>
    </div>
  )
}
