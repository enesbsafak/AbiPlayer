import { memo } from 'react'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText, QualityBadge } from '@/components/ui'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import type { CardFocusProps } from '@/components/catalog/card-focus'
import { inferContentQualityLabel } from '@/services/quality'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

const text = strings.catalog.cards

interface VODCardProps extends CardFocusProps {
  item: Channel
  onPlay: (item: Channel) => void
  eagerImage?: boolean
}

/**
 * A film or a series: the poster whole (2:3, radius 20), the title beneath it
 * and one quiet line of year and rating. No frame around it. The favourite
 * star sits on the poster's corner.
 */
export const VODCard = memo(function VODCard({
  item,
  onPlay,
  eagerImage = false,
  focusProps,
  secondaryTabIndex
}: VODCardProps) {
  const artwork = item.coverUrl || item.logo
  const qualityLabel = inferContentQualityLabel(item)
  const isSeries = item.type === 'series'
  const fallbackGroup = isSeries ? text.seriesFallbackGroup : text.filmFallbackGroup
  const meta = [item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · ') || item.group || item.categoryName || fallbackGroup

  // A wrapper rather than one big button: the favourite toggle is a second
  // control on the card and buttons cannot be nested.
  return (
    <div className="group relative flex w-full flex-col">
      <button
        type="button"
        className="flex w-full flex-col gap-2.5 rounded-card text-left"
        onClick={() => onPlay(item)}
        aria-label={strings.common.playItem(item.name)}
        {...focusProps}
      >
        <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-card bg-raised">
          <LazyImage src={artwork} alt="" className="h-full w-full" eager={eagerImage} />
          {qualityLabel && (
            <span className="absolute left-2.5 top-2.5">
              <QualityBadge label={qualityLabel} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <ClampText
            as="span"
            lines={2}
            titleText={item.name}
            className={`h-10 text-[15px] font-bold leading-5 text-white transition-colors ${
              isSeries ? 'group-hover:text-sky' : 'group-hover:text-mint'
            }`}
          >
            {item.name}
          </ClampText>
          <span className="h-[18px] truncate text-[13px] leading-[18px] text-surface-500">{meta}</span>
        </span>
      </button>
      <div className="absolute right-2 top-2">
        <FavoriteToggle
          channelId={item.id}
          item={item}
          tabIndex={secondaryTabIndex}
          className="bg-ground/85 text-white hover:bg-ground"
        />
      </div>
    </div>
  )
})
