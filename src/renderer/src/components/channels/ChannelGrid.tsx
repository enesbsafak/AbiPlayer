import { useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChannelCard } from './ChannelCard'
import type { Channel } from '@/types/playlist'

interface ChannelGridProps {
  channels: Channel[]
  onPlay: (channel: Channel) => void
}

const COLS_MAP = {
  sm: 2,
  md: 3,
  lg: 4,
  xl: 5,
  '2xl': 6
}

function useColumns(): number {
  // Simple responsive columns based on window width
  if (typeof window === 'undefined') return 4
  const w = window.innerWidth
  if (w < 640) return 2
  if (w < 768) return 3
  if (w < 1024) return 4
  if (w < 1280) return 5
  if (w < 1536) return 6
  return 7
}

export function ChannelGrid({ channels, onPlay }: ChannelGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const cols = useColumns()

  const rows = useMemo(() => {
    const result: Channel[][] = []
    for (let i = 0; i < channels.length; i += cols) {
      result.push(channels.slice(i, i + cols))
    }
    return result
  }, [channels, cols])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current?.parentElement ?? null,
    estimateSize: () => 200,
    overscan: 3
  })

  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-surface-500">
        <p className="text-lg">No channels found</p>
        <p className="text-sm mt-1">Try selecting a different category or add a source</p>
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
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {rows[virtualRow.index].map((channel) => (
                <ChannelCard key={channel.id} channel={channel} onPlay={onPlay} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
