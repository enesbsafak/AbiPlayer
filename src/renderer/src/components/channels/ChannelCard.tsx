import { memo } from 'react'
import { Radio } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText, QualityBadge } from '@/components/ui'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import type { CardFocusProps } from '@/components/catalog/card-focus'
import { inferContentQualityLabel } from '@/services/quality'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

const text = strings.catalog.cards

interface ChannelCardProps extends CardFocusProps {
  channel: Channel
  onPlay: (channel: Channel) => void
  eagerImage?: boolean
}

/**
 * Any catalog item as a card: its artwork in a 16:9 raised box (logos whole,
 * on the raised surface; pictures fill it), the name beneath. No frame. The
 * pages use rows for channels and posters for films and series; this card
 * is the generic grid's.
 */
export const ChannelCard = memo(function ChannelCard({
  channel,
  onPlay,
  eagerImage = false,
  focusProps,
  secondaryTabIndex
}: ChannelCardProps) {
  const artwork = channel.logo || channel.coverUrl
  const qualityLabel = inferContentQualityLabel(channel)
  const isLive = channel.type === 'live'
  const groupLabel = channel.group || channel.categoryName || (isLive ? text.liveFallbackGroup : text.mediaFallbackGroup)

  return (
    <div className="group relative flex flex-col">
      <button
        type="button"
        className="flex w-full flex-col gap-2.5 rounded-card text-left"
        onClick={() => onPlay(channel)}
        aria-label={strings.common.playItem(channel.name)}
        {...focusProps}
      >
        <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-card bg-raised">
          {artwork ? (
            <LazyImage
              src={artwork}
              alt=""
              className={isLive ? 'h-full w-full p-5' : 'h-full w-full'}
              fit={isLive ? 'contain' : 'cover'}
              eager={eagerImage}
            />
          ) : (
            <Radio size={28} className="text-surface-600" aria-hidden="true" />
          )}
          {isLive && (
            <span
              className="absolute left-2.5 top-2.5 flex h-6 items-center gap-1.5 rounded-full bg-coral px-2.5 text-xs font-bold text-ink"
              aria-label={text.liveBadgeLabel}
            >
              <span className="size-1.5 rounded-full bg-ink" aria-hidden="true" />
              {strings.common.live}
            </span>
          )}
          {qualityLabel && (
            <span className="absolute bottom-2.5 left-2.5">
              <QualityBadge label={qualityLabel} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <ClampText as="span" lines={2} titleText={channel.name} className="h-10 text-[15px] font-bold leading-5 text-white">
            {channel.name}
          </ClampText>
          <span className="h-[18px] truncate text-[13px] leading-[18px] text-surface-500">{groupLabel}</span>
        </span>
      </button>
      <div className="absolute right-2 top-2">
        <FavoriteToggle
          channelId={channel.id}
          item={channel}
          tabIndex={secondaryTabIndex}
          className="bg-ground/85 text-white hover:bg-ground"
        />
      </div>
    </div>
  )
})
