import { memo } from 'react'
import { Star, Play, Radio } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

interface ChannelCardProps {
  channel: Channel
  onPlay: (channel: Channel) => void
}

export const ChannelCard = memo(function ChannelCard({ channel, onPlay }: ChannelCardProps) {
  const { isFavorite, toggleFavorite } = useStore()
  const fav = isFavorite(channel.id)

  return (
    <div
      className="group relative flex flex-col rounded-xl border border-surface-800 bg-surface-900 overflow-hidden hover:border-surface-600 transition-all cursor-pointer hover:shadow-lg hover:shadow-black/20"
      onClick={() => onPlay(channel)}
    >
      <div className="relative aspect-video bg-surface-800 flex items-center justify-center">
        {channel.logo ? (
          <LazyImage
            src={channel.logo}
            alt={channel.name}
            className="h-full w-full object-contain p-4"
          />
        ) : (
          <Radio size={32} className="text-surface-600" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
          <Play
            size={40}
            className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg"
            fill="white"
          />
        </div>
        {channel.type === 'live' && (
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            Live
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="truncate text-sm font-medium">{channel.name}</p>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(channel.id) }}
          className="shrink-0 rounded-full p-1 hover:bg-surface-700 transition-colors"
        >
          <Star size={14} className={fav ? 'fill-yellow-400 text-yellow-400' : 'text-surface-500'} />
        </button>
      </div>
    </div>
  )
})
