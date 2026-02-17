import { memo } from 'react'
import { Play, Star } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import type { Channel } from '@/types/playlist'

interface VODCardProps {
  item: Channel
  onPlay: (item: Channel) => void
}

export const VODCard = memo(function VODCard({ item, onPlay }: VODCardProps) {
  return (
    <div
      className="group relative flex flex-col rounded-xl border border-surface-800 bg-surface-900 overflow-hidden hover:border-surface-600 transition-all cursor-pointer"
      onClick={() => onPlay(item)}
    >
      <div className="relative aspect-[2/3] bg-surface-800">
        <LazyImage src={item.logo || item.coverUrl} alt={item.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
          <Play size={36} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="white" />
        </div>
        {item.rating && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5">
            <Star size={10} className="fill-yellow-400 text-yellow-400" />
            <span className="text-[10px] font-bold">{item.rating}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{item.name}</p>
        {item.year && <p className="text-xs text-surface-500 mt-0.5">{item.year}</p>}
      </div>
    </div>
  )
})
