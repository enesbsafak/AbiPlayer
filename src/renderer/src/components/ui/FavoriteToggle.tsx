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
        className={`inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-4 py-2 text-sm font-medium text-surface-200 transition-colors hover:bg-surface-800 hover:text-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      >
        <Star size={16} className={isFavorite ? 'fill-amber-400 text-amber-400' : ''} aria-hidden="true" />
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
      className={`shrink-0 rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <Star size={14} className={isFavorite ? 'fill-amber-400 text-amber-400' : ''} aria-hidden="true" />
    </button>
  )
}
