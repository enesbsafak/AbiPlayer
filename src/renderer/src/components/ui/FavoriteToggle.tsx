import { Star } from 'lucide-react'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

const text = strings.common

interface FavoriteToggleProps {
  channelId: string
  /**
   * The item as the caller shows it. Passed on to `toggleFavorite`, so the
   * favourite's snapshot is taken even when the card is rendered from a
   * snapshot or a record no longer in the catalog.
   */
  item?: Channel
  /** Added to the icon's accessible name, so a grid of stars is not a list of identical labels. */
  itemName?: string
  /** `button` is the labelled variant used in detail views. */
  variant?: 'icon' | 'button'
  className?: string
  /** For grids with a roving tab stop: -1 keeps the star out of the Tab order. */
  tabIndex?: number
}

/**
 * Selects the membership itself rather than the store's `isFavorite`
 * function: that function never changes identity, so a component that called
 * it during render was never told the answer had changed and its star stayed
 * as it was until something else re-rendered it.
 */
export function FavoriteToggle({ channelId, item, itemName, variant = 'icon', className = '', tabIndex }: FavoriteToggleProps) {
  const isFavorite = useStore((s) => s.favoriteIds.has(channelId))
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const action = isFavorite ? text.removeFromFavorites : text.addToFavorites
  const label = itemName ? text.favoriteActionFor(action, itemName) : action

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={() => toggleFavorite(channelId, item)}
        tabIndex={tabIndex}
        className={`inline-flex h-[52px] items-center gap-2.5 rounded-full border-2 border-white/50 bg-transparent px-6 text-base font-medium text-white transition-colors hover:border-white ${className}`}
      >
        <Star size={20} strokeWidth={2.4} className={isFavorite ? 'fill-sun text-sun' : ''} aria-hidden="true" />
        {isFavorite ? text.removeFromFavoritesButton : text.addToFavoritesButton}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(channelId, item)}
      tabIndex={tabIndex}
      aria-label={label}
      title={action}
      // Round, 40 px; `className` sets its ground (on a coloured row: ink).
      className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-colors ${className || 'text-surface-400 hover:bg-surface-800 hover:text-white'}`}
    >
      <Star size={19} strokeWidth={2.4} className={isFavorite ? 'fill-sun text-sun' : ''} aria-hidden="true" />
    </button>
  )
}
