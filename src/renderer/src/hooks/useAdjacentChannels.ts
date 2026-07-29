import { useMemo } from 'react'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
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
 */
export function useAdjacentChannels(currentChannel: Channel | null): AdjacentChannels {
  const channels = useStore((s) => s.channels)
  const categories = useStore((s) => s.categories)
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)

  const candidates = useMemo(() => {
    if (!currentChannel) return []

    const sameTypeAndSource = channels.filter(
      (channel) =>
        channel.type === currentChannel.type &&
        channel.sourceId === currentChannel.sourceId &&
        isPlayableChannel(channel)
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
  }, [channels, categories, currentChannel, selectedCategoryId])

  return useMemo(() => {
    if (!currentChannel) return { previous: null, next: null }

    const index = candidates.findIndex((item) => item.id === currentChannel.id)
    return {
      previous: index > 0 ? candidates[index - 1] : null,
      next: index >= 0 && index < candidates.length - 1 ? candidates[index + 1] : null
    }
  }, [candidates, currentChannel])
}
