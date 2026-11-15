import { memo, useState } from 'react'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import type { CardFocusProps } from '@/components/catalog/card-focus'
import type { CardGridLayout } from '@/components/catalog/VirtualCardGrid'
import { formatClockTime } from '@/hooks/useMinuteClock'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { channelInitial, minutesLeft, programmeProgress, type ChannelGuide } from './live-guide'

/**
 * Rows of 62 px with a 10 px gap; one column, two side by side once each can
 * be 560 px wide (a very wide window), three past that.
 */
export const CHANNEL_ROW_LAYOUT: CardGridLayout = {
  minCardWidth: 560,
  maxColumns: 3,
  minColumns: 1,
  gap: 10,
  gapClass: 'gap-2.5',
  rowGapClass: 'pb-2.5',
  estimateCardHeight: () => 62,
  virtualizeAbove: 60
}

/**
 * A row's logo: the channel's initial in the display face until the logo has
 * loaded, and for good when there is none or it does not load. Never an
 * empty dark square.
 */
function RowLogo({ channel, selected, eager }: { channel: Channel; selected: boolean; eager: boolean }) {
  const [state, setState] = useState<{ src: string; status: 'loaded' | 'failed' } | null>(null)
  const logo = channel.logo && !(state?.src === channel.logo && state.status === 'failed') ? channel.logo : null
  const shown = !!logo && state?.src === logo && state.status === 'loaded'
  return (
    <span
      className={`relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] ${
        selected ? 'bg-ink text-coral' : 'bg-ground text-surface-500'
      }`}
    >
      {!shown && (
        <span aria-hidden="true" className="font-title text-[22px] leading-none">
          {channelInitial(channel.name)}
        </span>
      )}
      {logo && (
        <img
          key={logo}
          src={logo}
          alt=""
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState({ src: logo, status: 'loaded' })}
          onError={() => setState({ src: logo, status: 'failed' })}
          className={`absolute inset-0 h-full w-full object-contain p-1 ${shown ? '' : 'invisible'}`}
        />
      )}
    </span>
  )
}

interface ChannelRowProps extends CardFocusProps {
  channel: Channel
  /** The channel in focus: filled with coral, ink on top, and shown in the side panel. */
  selected: boolean
  guide: ChannelGuide | null
  now: number
  onPlay: (channel: Channel) => void
  /** Focus or pointer reached the row: it becomes the channel in focus. */
  onActivate?: (channel: Channel) => void
  eagerImage?: boolean
}

/**
 * One channel: logo, name, what is on now with a thick progress bar and the
 * time left when the guide is known (less when it is not), and the favourite
 * star. A click, or Enter, plays it; arrows and the pointer only look.
 */
export const ChannelRow = memo(function ChannelRow({
  channel,
  selected,
  guide,
  now,
  onPlay,
  onActivate,
  eagerImage = false,
  focusProps,
  secondaryTabIndex
}: ChannelRowProps) {
  const onAir = guide?.now ?? null
  const progress = onAir ? programmeProgress(onAir, now) : null
  const sub = onAir?.title || channel.group || channel.categoryName || ''
  const activate = onActivate ? () => onActivate(channel) : undefined

  return (
    <div
      className={`flex h-[62px] min-w-0 items-center rounded-card ${
        selected ? 'bg-coral text-ink' : 'bg-raised text-white'
      }`}
      onMouseEnter={activate}
    >
      <button
        type="button"
        onClick={() => onPlay(channel)}
        onFocus={activate}
        aria-label={strings.common.playItem(channel.name)}
        className="flex h-full min-w-0 flex-1 items-center gap-3.5 rounded-card pl-2.5 pr-3 text-left"
        {...focusProps}
      >
        <RowLogo channel={channel} selected={selected} eager={eagerImage} />
        <span className="flex min-w-0 flex-[0_1_260px] flex-col">
          <span className="truncate text-[17px] font-bold leading-6">{channel.name}</span>
          {sub && (
            <span className={`truncate text-[15px] leading-5 ${selected ? 'text-ink/80' : 'text-surface-500'}`}>{sub}</span>
          )}
        </span>
        {onAir && progress !== null && (
          <>
            <span
              role="img"
              aria-label={strings.catalog.live.programmeShare(progress)}
              className={`h-2.5 min-w-12 flex-1 overflow-hidden rounded-full ${selected ? 'bg-ink/25' : 'bg-white/20'}`}
            >
              <span
                className={`block h-full rounded-full ${selected ? 'bg-ink' : 'bg-white'}`}
                style={{ width: `${progress}%` }}
              />
            </span>
            <span className="w-[104px] shrink-0 whitespace-nowrap text-right text-[15px] font-bold">
              {strings.catalog.home.remaining(minutesLeft(onAir, now))}
            </span>
          </>
        )}
        {!onAir && guide?.next && (
          <span className={`ml-auto shrink-0 whitespace-nowrap text-[15px] ${selected ? 'text-ink/80' : 'text-surface-500'}`}>
            {strings.catalog.live.next} {formatClockTime(guide.next.start)}
          </span>
        )}
      </button>
      <FavoriteToggle
        channelId={channel.id}
        item={channel}
        tabIndex={secondaryTabIndex}
        className={`mr-2.5 ${selected ? 'bg-ink text-white hover:bg-ink' : 'bg-ground text-surface-400 hover:text-white'}`}
      />
    </div>
  )
})
