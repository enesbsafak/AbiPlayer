import { memo } from 'react'
import { Play, Star } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText, QualityBadge } from '@/components/ui'
import { inferContentQualityLabel } from '@/services/quality'
import type { Channel } from '@/types/playlist'

interface VODCardProps {
  item: Channel
  onPlay: (item: Channel) => void
  eagerImage?: boolean
}

export const VODCard = memo(function VODCard({
  item,
  onPlay,
  eagerImage = false
}: VODCardProps) {
  const artwork = item.coverUrl || item.logo
  const qualityLabel = inferContentQualityLabel(item)

  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900 transition-colors hover:border-surface-700"
      onClick={() => onPlay(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(item) } }}
      aria-label={`${item.name} oynat`}
    >
      <div className="relative aspect-[2/3] bg-surface-800">
        <LazyImage src={artwork} alt={item.name} className="h-full w-full" eager={eagerImage} />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <Play size={32} className="opacity-0 transition-opacity group-hover:opacity-100" fill="white" color="white" />
        </div>
        {qualityLabel && (
          <div className="absolute left-2 top-2">
            <QualityBadge label={qualityLabel} />
          </div>
        )}
        {item.rating && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-surface-900/90 px-1.5 py-0.5">
            <Star size={10} className="fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="text-caption font-bold text-surface-200">{item.rating}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <ClampText as="p" lines={2} className="text-sm font-medium text-surface-100">
          {item.name}
        </ClampText>
        <div className="mt-1 flex items-center justify-between gap-2 text-label text-surface-500">
          <ClampText as="span" lines={1} className="min-w-0 flex-1">
            {item.group || item.categoryName || 'Film'}
          </ClampText>
          {item.year && <span className="shrink-0 text-surface-400">{item.year}</span>}
        </div>
      </div>
    </div>
  )
})
