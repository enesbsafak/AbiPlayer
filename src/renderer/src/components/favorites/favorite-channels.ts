import { useMemo } from 'react'
import { useStore } from '@/store'
import { catalog, useCatalogVersion } from '@/catalog'
import { channelFromFavoriteSnapshot, type FavoriteSnapshot } from '@/store/favorites-slice'
import type { Channel } from '@/types/playlist'

/**
 * The cards for the favourites, in the order they were added. The catalog
 * record wins when it is in memory; otherwise the persisted snapshot renders
 * the card, so favourites show right after a restart and for sources that are
 * not loaded. Favourites of deleted sources are left out.
 */
export function resolveFavoriteChannels(
  favoriteIds: ReadonlySet<string>,
  snapshots: Readonly<Record<string, FavoriteSnapshot>>,
  findItem: (id: string) => Channel | undefined,
  sourceIds: ReadonlySet<string>,
  limit = Number.POSITIVE_INFINITY
): Channel[] {
  const result: Channel[] = []
  for (const id of favoriteIds) {
    if (result.length >= limit) break
    const live = findItem(id)
    const snapshot = snapshots[id]
    const channel = live ?? (snapshot ? channelFromFavoriteSnapshot(snapshot) : undefined)
    if (!channel || !sourceIds.has(channel.sourceId)) continue
    result.push(channel)
  }
  return result
}

export function useFavoriteChannels(limit?: number): Channel[] {
  const favoriteIds = useStore((s) => s.favoriteIds)
  const snapshots = useStore((s) => s.favoriteSnapshots)
  const sources = useStore((s) => s.sources)
  const catalogVersion = useCatalogVersion()

  return useMemo(() => {
    void catalogVersion
    const sourceIds = new Set(sources.map((source) => source.id))
    return resolveFavoriteChannels(favoriteIds, snapshots, (id) => catalog.getItem(id), sourceIds, limit)
  }, [favoriteIds, snapshots, sources, catalogVersion, limit])
}
