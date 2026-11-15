import type { Ref } from 'react'
import { VirtualCardGrid, type CardGridLayout, type CardRenderProps, type VirtualCardGridHandle } from '@/components/catalog/VirtualCardGrid'
import { VODCard } from './VODCard'
import type { Channel } from '@/types/playlist'

/**
 * 2:3 poster plus two title lines, the group / year line and the border;
 * rows are measured after render. Most rows hold a two-line title, and an
 * estimate that matches spares the virtualizer a re-layout per measured row.
 */
export const POSTER_GRID_LAYOUT: CardGridLayout = {
  minCardWidth: 168,
  maxColumns: 9,
  gap: 16,
  gapClass: 'gap-4',
  rowGapClass: 'pb-4',
  estimateCardHeight: (cardWidth) => cardWidth * 1.5 + 86,
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
    <div className="flex flex-col items-center justify-center py-20 text-surface-400">
      <p className="text-lg">İçerik bulunamadı</p>
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

export function VODGrid({ items, onPlay, scrollElement, ariaLabel = 'İçerikler', handleRef }: VODGridProps) {
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
