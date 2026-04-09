import { memo } from 'react'
import { Star, Play, Radio } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText, QualityBadge } from '@/components/ui'
import { inferContentQualityLabel } from '@/services/quality'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

interface ChannelCardProps {
  channel: Channel
  onPlay: (channel: Channel) => void
  eagerImage?: boolean
}

export const ChannelCard = memo(function ChannelCard({
  channel,
  onPlay,
  eagerImage = false
}: ChannelCardProps) {
  const isFavorite = useStore((s) => s.isFavorite)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const fav = isFavorite(channel.id)
  const artwork = channel.logo || channel.coverUrl
  const qualityLabel = inferContentQualityLabel(channel)

  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900 transition-colors hover:border-surface-700"
      onClick={() => onPlay(channel)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(channel) } }}
      aria-label={`${channel.name} oynat`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-surface-800">
        {artwork ? (
          <LazyImage
            src={artwork}
            alt={channel.name}
            className={channel.type === 'live' ? 'h-full w-full p-4' : 'h-full w-full'}
            fit={channel.type === 'live' ? 'contain' : 'cover'}
            eager={eagerImage}
          />
        ) : (
          <Radio size={28} className="text-surface-600" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <Play
            size={36}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            fill="white"
            color="white"
          />
        </div>
        {channel.type === 'live' && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-caption font-medium text-white" aria-label="Canlı yayın">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            Canlı
          </div>
        )}
        {qualityLabel && (
          <div className="absolute right-2 top-2">
            <QualityBadge label={qualityLabel} />
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <ClampText as="p" lines={2} className="text-body-sm font-medium text-surface-100">
            {channel.name}
          </ClampText>
          <ClampText as="p" lines={1} className="mt-0.5 text-label text-surface-500">
            {channel.group || channel.categoryName || (channel.type === 'live' ? 'Yayın' : 'Medya')}
          </ClampText>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(channel.id) }}
          className="shrink-0 rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-300"
          aria-label={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
        >
          <Star
            size={14}
            className={fav ? 'fill-amber-400 text-amber-400' : ''}
          />
        </button>
      </div>
    </div>
  )
})
