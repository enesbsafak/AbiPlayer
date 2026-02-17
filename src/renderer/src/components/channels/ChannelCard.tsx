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
  const isFavorite = useStore((s) => s.isFavorite)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const fav = isFavorite(channel.id)
  const artwork = channel.logo || channel.coverUrl

  return (
    <div
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/16 bg-[linear-gradient(172deg,rgba(38,56,88,0.7),rgba(21,34,58,0.65))] shadow-[0_12px_26px_rgba(0,0,0,0.26)] transition-all duration-300 hover:-translate-y-1 hover:border-accent/70 hover:shadow-[0_22px_34px_rgba(0,0,0,0.36)]"
      onClick={() => onPlay(channel)}
    >
      <div className="relative flex aspect-video items-center justify-center bg-surface-800/80">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(110,168,255,0.32),transparent_46%),radial-gradient(circle_at_82%_18%,rgba(87,215,196,0.2),transparent_56%)]" />
        {artwork ? (
          <LazyImage
            src={artwork}
            alt={channel.name}
            className={channel.type === 'live' ? 'h-full w-full p-4' : 'h-full w-full'}
            fit={channel.type === 'live' ? 'contain' : 'cover'}
          />
        ) : (
          <Radio size={32} className="text-surface-500" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/45">
          <Play
            size={40}
            className="opacity-0 drop-shadow-lg transition-opacity group-hover:opacity-100"
            fill="white"
            color="white"
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
        {channel.type === 'live' && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-red-300/35 bg-red-500/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Canli
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-2 p-3.5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold tracking-wide text-surface-50">{channel.name}</p>
          <p className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-surface-400">
            {channel.group || channel.categoryName || (channel.type === 'live' ? 'Yayin' : 'Medya')}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(channel.id) }}
          className="shrink-0 rounded-full border border-surface-600/45 bg-surface-800/80 p-1.5 transition-colors hover:border-accent/60 hover:bg-surface-700"
          aria-label={fav ? 'Favorilerden cikar' : 'Favorilere ekle'}
        >
          <Star
            size={14}
            className={fav ? 'fill-amber-300 text-amber-300' : 'text-surface-400'}
          />
        </button>
      </div>
    </div>
  )
})
