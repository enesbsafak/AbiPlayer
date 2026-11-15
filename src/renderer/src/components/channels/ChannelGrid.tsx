import type { Ref } from 'react'
import { VirtualCardGrid, type CardGridLayout, type CardRenderProps, type VirtualCardGridHandle } from '@/components/catalog/VirtualCardGrid'
import { ChannelCard } from './ChannelCard'
import type { Channel } from '@/types/playlist'

/** 16:9 artwork plus two title lines and the group line. */
export const CHANNEL_GRID_LAYOUT: CardGridLayout = {
  minCardWidth: 178,
  maxColumns: 10,
  gap: 14,
  gapClass: 'gap-3.5',
  rowGapClass: 'pb-3.5',
  estimateCardHeight: (cardWidth) => cardWidth * (9 / 16) + 76,
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
    <div className="flex flex-col items-center justify-center py-20 text-surface-400">
      <p className="text-lg">Kanal bulunamadı</p>
      <p className="text-sm mt-1">Farklı bir kategori seçmeyi veya kaynak eklemeyi deneyin</p>
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

export function ChannelGrid({ channels, onPlay, scrollElement, ariaLabel = 'Kanallar', handleRef }: ChannelGridProps) {
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
