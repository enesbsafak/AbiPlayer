import { Star } from 'lucide-react'
import { useStore } from '@/store'

interface FavoriteToggleProps {
  channelId: string
  /** Added to the icon's accessible name, so a grid of stars is not a list of identical labels. */
  itemName?: string
  /** `button` is the labelled variant used in detail views. */
  variant?: 'icon' | 'button'
  className?: string
}

/**
 * Selects the membership itself rather than the store's `isFavorite`
 * function: that function never changes identity, so a component that called
 * it during render was never told the answer had changed and its star stayed
 * as it was until something else re-rendered it.
 */
export function FavoriteToggle({ channelId, itemName, variant = 'icon', className = '' }: FavoriteToggleProps) {
  const isFavorite = useStore((s) => s.favoriteIds.has(channelId))
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const action = isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'
  const label = itemName ? `${action}: ${itemName}` : action

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={() => toggleFavorite(channelId)}
        className={`inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-4 py-2 text-sm font-medium text-surface-200 transition-colors hover:bg-surface-800 hover:text-surface-50 ${className}`}
      >
        <Star size={16} className={isFavorite ? 'fill-amber-400 text-amber-400' : ''} aria-hidden="true" />
        {isFavorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(channelId)}
      aria-label={label}
      title={action}
      className={`shrink-0 rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-300 ${className}`}
    >
      <Star size={14} className={isFavorite ? 'fill-amber-400 text-amber-400' : ''} aria-hidden="true" />
    </button>
  )
}
