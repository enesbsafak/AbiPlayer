import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StarIcon } from '@/components/ui/icons'
import { GroupedResults } from '@/components/catalog/GroupedResults'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { useFavoriteChannels } from './favorite-channels'

const text = strings.catalog.favorites

interface FavoritesViewProps {
  onPlay: (channel: Channel) => void
}

/**
 * Every favourite, across sources, in the order they were added: channels as
 * rows, films and series as posters, each part headed. With none yet, a
 * sentence on how to add one and the way to the channels.
 */
export function FavoritesView({ onPlay }: FavoritesViewProps) {
  const favorites = useFavoriteChannels()
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-tile bg-raised px-8 py-14 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-sun text-ink">
          <StarIcon size={40} />
        </span>
        <h2 className="font-title text-[34px] leading-[1.05]">{text.empty}</h2>
        <p className="max-w-md text-[17px] text-white/80">{text.emptyHint}</p>
        <Link
          to="/live"
          className="mt-2 flex h-14 items-center rounded-full border-2 border-white/50 px-7 text-[17px] font-bold text-white transition-colors hover:border-white"
        >
          {text.browseLive}
        </Link>
      </div>
    )
  }

  return (
    <div ref={setScrollElement} className="-mx-1.5 h-full overflow-y-auto px-1.5 pb-3 pt-1.5">
      <GroupedResults items={favorites} onOpen={onPlay} scrollElement={scrollElement} idPrefix="favorites" />
    </div>
  )
}
