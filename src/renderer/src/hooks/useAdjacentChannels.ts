import { useMemo } from 'react'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
import { useCatalogCategories, useVisibleCatalogItems } from '@/catalog'
import type { Channel } from '@/types/playlist'

export interface AdjacentChannels {
  previous: Channel | null
  next: Channel | null
}

/**
 * Resolves what "previous/next" mean for the channel being played.
 *
 * Skipping stays inside the category the user is actually browsing, so pressing
 * next in a filtered list doesn't jump into unrelated content. Falls back to the
 * whole source when the active category yields nothing.
 *
 * The candidate list runs through the same view rules as the on-screen lists —
 * otherwise "next" follows raw playlist order and lands somewhere the user
 * cannot see in the list they picked the channel from.
 */
export function useAdjacentChannels(currentChannel: Channel | null): AdjacentChannels {
  const sourceId = currentChannel?.sourceId ?? null
  const type = currentChannel?.type ?? 'live'
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const categories = useCatalogCategories(sourceId, type)

  // The browsed category counts only when it belongs to this source and type.
  const effectiveCategoryId =
    selectedCategoryId && categories.some((category) => category.id === selectedCategoryId)
      ? selectedCategoryId
      : (currentChannel?.categoryId ?? null)

  const sameTypeAndSource = useVisibleCatalogItems(sourceId, type)
  const withinCategory = useVisibleCatalogItems(sourceId, type, effectiveCategoryId)

  return useMemo(() => {
    if (!currentChannel) return { previous: null, next: null }
    const inCategory = effectiveCategoryId
      ? withinCategory.filter(isPlayableChannel)
      : []
    const candidates = inCategory.length > 0 ? inCategory : sameTypeAndSource

    const index = candidates.findIndex((item) => item.id === currentChannel.id)
    if (index < 0) return { previous: null, next: null }

    // Walk outwards instead of filtering the whole list first: a source can
    // list 200,000 items and only the two neighbours matter.
    let previous: Channel | null = null
    for (let i = index - 1; i >= 0; i--) {
      if (isPlayableChannel(candidates[i])) {
        previous = candidates[i]
        break
      }
    }
    let next: Channel | null = null
    for (let i = index + 1; i < candidates.length; i++) {
      if (isPlayableChannel(candidates[i])) {
        next = candidates[i]
        break
      }
    }
    return { previous, next }
  }, [currentChannel, effectiveCategoryId, withinCategory, sameTypeAndSource])
}
