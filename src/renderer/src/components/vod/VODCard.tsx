import { memo } from 'react'
import { Play, Star } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import type { Channel } from '@/types/playlist'

interface VODCardProps {
  item: Channel
  onPlay: (item: Channel) => void
}

export const VODCard = memo(function VODCard({ item, onPlay }: VODCardProps) {
  const artwork = item.coverUrl || item.logo

  return (
    <div
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/16 bg-[linear-gradient(176deg,rgba(36,54,86,0.78),rgba(20,31,52,0.7))] shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition-all duration-300 hover:-translate-y-1 hover:border-signal/70 hover:shadow-[0_24px_34px_rgba(0,0,0,0.38)]"
      onClick={() => onPlay(item)}
    >
      <div className="relative aspect-[2/3] bg-surface-800">
        <LazyImage src={artwork} alt={item.name} className="h-full w-full" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_34%,rgba(0,0,0,0.72)_100%)]" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/35">
          <Play size={36} className="opacity-0 transition-opacity group-hover:opacity-100" fill="white" color="white" />
        </div>
        {item.rating && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-amber-300/45 bg-black/65 px-2 py-0.5">
            <Star size={10} className="fill-amber-300 text-amber-300" />
            <span className="text-[10px] font-bold text-amber-100">{item.rating}</span>
          </div>
        )}
      </div>
      <div className="p-3.5">
        <p className="truncate text-sm font-semibold tracking-wide text-surface-50">{item.name}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.13em] text-surface-400">
          <span className="truncate">{item.group || item.categoryName || 'Film'}</span>
          {item.year && <span className="shrink-0 text-surface-300">{item.year}</span>}
        </div>
      </div>
    </div>
  )
})
