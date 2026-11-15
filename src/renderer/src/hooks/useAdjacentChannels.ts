import { useMemo } from 'react'
import { useStore } from '@/store'
import { selectedCategoryFor } from '@/store/playlist-slice'
import { isPlayableChannel } from '@/services/playback'
import { useVisibleCatalogItems } from '@/catalog'
import type { Channel } from '@/types/playlist'

export interface AdjacentChannels {
  previous: Channel | null
  next: Channel | null
}

const NONE: AdjacentChannels = { previous: null, next: null }

// The store hands out one cached array per (source, type, category, view
// settings) until its data changes, so an id -> position map per array is
// built once per version instead of scanning the list on every lookup.
const positions = new WeakMap<readonly Channel[], Map<string, number>>()

/** Position of `id` in `list`, or -1. */
export function positionInList(list: readonly Channel[], id: string): number {
  let index = positions.get(list)
  if (!index) {
    index = new Map()
    for (const [i, item] of list.entries()) {
      if (!index.has(item.id)) index.set(item.id, i)
    }
    positions.set(list, index)
  }
  return index.get(id) ?? -1
}

/**
 * The playable neighbours of `id` in the first list that contains it.
 * Walks outwards from its position: a source can list 200,000 items and only
 * the two neighbours matter.
 */
export function findAdjacent(lists: readonly (readonly Channel[])[], id: string): AdjacentChannels {
  for (const list of lists) {
    const index = positionInList(list, id)
    if (index < 0) continue
    let previous: Channel | null = null
    for (let i = index - 1; i >= 0; i--) {
      const candidate = list[i]
      if (candidate && isPlayableChannel(candidate)) {
        previous = candidate
        break
      }
    }
    let next: Channel | null = null
    for (let i = index + 1; i < list.length; i++) {
      const candidate = list[i]
      if (candidate && isPlayableChannel(candidate)) {
        next = candidate
        break
      }
    }
    return { previous, next }
  }
  return NONE
}

/**
 * Resolves what "previous/next" mean for the channel being played.
 *
 * Skipping stays inside the category the user is browsing for that source and
 * type, so pressing next in a filtered list doesn't jump into unrelated
 * content. When the channel is not in that category (it was opened from
 * search or favourites), its own category is used, then the whole source.
 *
 * The candidate lists are the same views the on-screen lists show; otherwise
 * "next" follows raw playlist order and lands somewhere the user cannot see
 * in the list they picked the channel from.
 */
export function useAdjacentChannels(currentChannel: Channel | null): AdjacentChannels {
  const sourceId = currentChannel?.sourceId ?? null
  const type = currentChannel?.type ?? 'live'
  const selectedCategoryId = useStore((s) => selectedCategoryFor(s.selectedCategoryIds, sourceId, type))
  const ownCategoryId = currentChannel?.categoryId ?? null

  const inSelected = useVisibleCatalogItems(sourceId, type, selectedCategoryId)
  const inOwn = useVisibleCatalogItems(sourceId, type, ownCategoryId)
  const all = useVisibleCatalogItems(sourceId, type)

  return useMemo(() => {
    if (!currentChannel) return NONE
    const candidates: (readonly Channel[] | null)[] = [
      selectedCategoryId ? inSelected : null,
      ownCategoryId ? inOwn : null,
      all
    ]
    const lists = candidates.filter((list): list is readonly Channel[] => list !== null)
    return findAdjacent(lists, currentChannel.id)
  }, [currentChannel, selectedCategoryId, ownCategoryId, inSelected, inOwn, all])
}
