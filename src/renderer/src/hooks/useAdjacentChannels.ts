import { useMemo } from 'react'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
import { applyCatalogView } from '@/services/catalog-view'
import { useCatalogView } from '@/hooks/useCatalogView'
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
  const channels = useStore((s) => s.channels)
  const categories = useStore((s) => s.categories)
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const catalogView = useCatalogView()

  const candidates = useMemo(() => {
    if (!currentChannel) return []

    const sameTypeAndSource = applyCatalogView(
      channels.filter(
        (channel) =>
          channel.type === currentChannel.type &&
          channel.sourceId === currentChannel.sourceId &&
          isPlayableChannel(channel)
      ),
      catalogView
    )

    const storeCategory = selectedCategoryId
      ? categories.find((c) => c.id === selectedCategoryId)
      : null
    const effectiveCategoryId =
      storeCategory &&
      storeCategory.type === currentChannel.type &&
      storeCategory.sourceId === currentChannel.sourceId
        ? selectedCategoryId
        : currentChannel.categoryId ?? null

    if (!effectiveCategoryId) return sameTypeAndSource

    const withinCategory = sameTypeAndSource.filter((ch) => ch.categoryId === effectiveCategoryId)
    return withinCategory.length > 0 ? withinCategory : sameTypeAndSource
  }, [channels, categories, currentChannel, selectedCategoryId, catalogView])

  return useMemo(() => {
    if (!currentChannel) return { previous: null, next: null }

    const index = candidates.findIndex((item) => item.id === currentChannel.id)
    return {
      previous: index > 0 ? candidates[index - 1] : null,
      next: index >= 0 && index < candidates.length - 1 ? candidates[index + 1] : null
    }
  }, [candidates, currentChannel])
}
