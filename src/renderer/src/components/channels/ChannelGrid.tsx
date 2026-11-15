import type { Ref } from 'react'
import { VirtualCardGrid, type CardGridLayout, type CardRenderProps, type VirtualCardGridHandle } from '@/components/catalog/VirtualCardGrid'
import { ChannelCard } from './ChannelCard'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

/** 16:9 artwork, a 10 px gap, two title lines and the group line. */
export const CHANNEL_GRID_LAYOUT: CardGridLayout = {
  minCardWidth: 190,
  maxColumns: 14,
  gap: 20,
  gapClass: 'gap-5',
  rowGapClass: 'pb-5',
  // Exact (fixed two-line title box); the row gap matches `gap`.
  estimateCardHeight: (cardWidth) => cardWidth * (9 / 16) + 10 + 40 + 2 + 18,
  virtualizeAbove: 120
}

export function renderChannelCard({ item, onOpen, eagerImage, focusProps, secondaryTabIndex }: CardRenderProps<Channel>) {
  return (
    <ChannelCard
      channel={item}
      onPlay={onOpen}
      eagerImage={eagerImage}
      focusProps={focusProps}
      secondaryTabIndex={secondaryTabIndex}
    />
  )
}

export function ChannelGridEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-tile bg-raised px-8 py-16 text-center">
      <p className="font-title text-[28px]">{strings.catalog.cards.noChannels}</p>
      <p className="max-w-md text-base text-surface-400">{strings.catalog.cards.noChannelsHint}</p>
    </div>
  )
}

interface ChannelGridProps {
  channels: readonly Channel[]
  onPlay: (channel: Channel) => void
  /** The element that scrolls the grid; omitted: the nearest scrolling ancestor. */
  scrollElement?: HTMLElement | null
  ariaLabel?: string
  handleRef?: Ref<VirtualCardGridHandle>
}

export function ChannelGrid({ channels, onPlay, scrollElement, ariaLabel = strings.catalog.types.live.plural, handleRef }: ChannelGridProps) {
  return (
    <VirtualCardGrid
      items={channels}
      layout={CHANNEL_GRID_LAYOUT}
      renderCard={renderChannelCard}
      onOpen={onPlay}
      scrollElement={scrollElement}
      ariaLabel={ariaLabel}
      empty={<ChannelGridEmpty />}
      handleRef={handleRef}
    />
  )
}
