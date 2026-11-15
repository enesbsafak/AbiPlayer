import type { Ref } from 'react'
import { VirtualCardGrid, type CardGridLayout, type CardRenderProps, type VirtualCardGridHandle } from '@/components/catalog/VirtualCardGrid'
import { VODCard } from './VODCard'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

/**
 * 2:3 poster, a 10 px gap, two title lines and the meta line; rows are
 * measured after render. A narrow minimum and a generous column cap keep the
 * posters near one size: a wider window gets more columns, not bigger posters.
 */
export const POSTER_GRID_LAYOUT: CardGridLayout = {
  minCardWidth: 150,
  maxColumns: 16,
  gap: 20,
  gapClass: 'gap-5',
  rowGapClass: 'pb-5',
  // Exact, not a guess: every card has the same height for its width (the
  // title box always holds two lines), so rows the virtualizer has not
  // measured sit exactly where measured ones will, and a restored scroll
  // position lands on the same card. The row gap matches `gap`.
  estimateCardHeight: (cardWidth) => cardWidth * 1.5 + 10 + 40 + 2 + 18,
  virtualizeAbove: 80
}

export function renderPosterCard({ item, onOpen, eagerImage, focusProps, secondaryTabIndex }: CardRenderProps<Channel>) {
  return (
    <VODCard
      item={item}
      onPlay={onOpen}
      eagerImage={eagerImage}
      focusProps={focusProps}
      secondaryTabIndex={secondaryTabIndex}
    />
  )
}

export function PosterGridEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-tile bg-raised px-8 py-16 text-center">
      <p className="font-title text-[28px]">{strings.catalog.cards.noContent}</p>
      <p className="max-w-md text-base text-surface-400">{strings.catalog.cards.noChannelsHint}</p>
    </div>
  )
}

interface VODGridProps {
  items: readonly Channel[]
  onPlay: (item: Channel) => void
  scrollElement?: HTMLElement | null
  ariaLabel?: string
  handleRef?: Ref<VirtualCardGridHandle>
}

export function VODGrid({ items, onPlay, scrollElement, ariaLabel = strings.catalog.cards.contentGrid, handleRef }: VODGridProps) {
  return (
    <VirtualCardGrid
      items={items}
      layout={POSTER_GRID_LAYOUT}
      renderCard={renderPosterCard}
      onOpen={onPlay}
      scrollElement={scrollElement}
      ariaLabel={ariaLabel}
      empty={<PosterGridEmpty />}
      handleRef={handleRef}
    />
  )
}
