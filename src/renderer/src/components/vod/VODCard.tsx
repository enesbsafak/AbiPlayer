import { memo } from 'react'
import { Play, Star } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText, QualityBadge } from '@/components/ui'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import { CARD_FOCUS_CLASS, type CardFocusProps } from '@/components/catalog/card-focus'
import { inferContentQualityLabel } from '@/services/quality'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

const text = strings.catalog.cards

interface VODCardProps extends CardFocusProps {
  item: Channel
  onPlay: (item: Channel) => void
  eagerImage?: boolean
}

export const VODCard = memo(function VODCard({
  item,
  onPlay,
  eagerImage = false,
  focusProps,
  secondaryTabIndex
}: VODCardProps) {
  const artwork = item.coverUrl || item.logo
  const qualityLabel = inferContentQualityLabel(item)
  const fallbackGroup = item.type === 'series' ? text.seriesFallbackGroup : text.filmFallbackGroup

  // A wrapper rather than one big button: the favourite toggle is a second
  // control on the card and buttons cannot be nested.
  return (
    <div className={`group relative flex w-full flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900 transition-colors hover:border-surface-700 focus-within:border-surface-700 ${CARD_FOCUS_CLASS}`}>
      <button
        type="button"
        className="flex w-full flex-1 flex-col text-left outline-none"
        onClick={() => onPlay(item)}
        aria-label={strings.common.playItem(item.name)}
        {...focusProps}
      >
        <div className="relative aspect-[2/3] w-full bg-surface-800">
          <LazyImage src={artwork} alt={item.name} className="h-full w-full" eager={eagerImage} />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40 group-focus-within:bg-black/40">
            <Play
              size={32}
              className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              fill="white"
              color="white"
              aria-hidden="true"
            />
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
        <div className="w-full p-3 pr-11">
          <ClampText as="p" lines={2} titleText={item.name} className="text-sm font-medium text-surface-100">
            {item.name}
          </ClampText>
          <div className="mt-1 flex items-center justify-between gap-2 text-label text-surface-500">
            <ClampText as="span" lines={1} titleText={item.group || item.categoryName || fallbackGroup} className="min-w-0 flex-1">
              {item.group || item.categoryName || fallbackGroup}
            </ClampText>
            {item.year && <span className="shrink-0 text-surface-400">{item.year}</span>}
          </div>
        </div>
      </button>
      <div className="absolute bottom-2.5 right-2">
        <FavoriteToggle channelId={item.id} item={item} tabIndex={secondaryTabIndex} />
      </div>
    </div>
  )
})
