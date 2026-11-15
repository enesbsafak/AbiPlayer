import type { StateCreator } from 'zustand'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import type { Channel } from '@/types/playlist'

const CONTENT_TYPES = new Set<Channel['type']>(['live', 'vod', 'series'])

/**
 * Enough of a favourite to render its card and start it when its catalog is
 * not in memory (after a restart, before the full sync; an inactive source).
 * No credential: Xtream items keep only their ids, M3U entries their URL.
 */
export interface FavoriteSnapshot {
  id: string
  name: string
  sourceId: string
  type: Channel['type']
  /** M3U entries only: the entry URL is their identity. */
  streamUrl?: string
  streamId?: number
  seriesId?: number
  containerExtension?: string
  logo?: string
  coverUrl?: string
  categoryId?: string
  categoryName?: string
  rating?: string
  year?: string
}

export function favoriteSnapshotOf(channel: Channel): FavoriteSnapshot {
  const snapshot: FavoriteSnapshot = {
    id: channel.id,
    name: channel.name,
    sourceId: channel.sourceId,
    type: channel.type
  }
  const isXtream = typeof channel.streamId === 'number' || typeof channel.seriesId === 'number'
  if (typeof channel.streamId === 'number') snapshot.streamId = channel.streamId
  if (typeof channel.seriesId === 'number') snapshot.seriesId = channel.seriesId
  if (!isXtream && channel.streamUrl) snapshot.streamUrl = channel.streamUrl
  if (channel.containerExtension) snapshot.containerExtension = channel.containerExtension
  if (channel.logo) snapshot.logo = channel.logo
  if (channel.coverUrl) snapshot.coverUrl = channel.coverUrl
  if (channel.categoryId) snapshot.categoryId = channel.categoryId
  const categoryName = channel.categoryName || channel.group
  if (categoryName) snapshot.categoryName = categoryName
  if (channel.rating) snapshot.rating = channel.rating
  if (channel.year) snapshot.year = channel.year
  return snapshot
}

/** The card a snapshot renders, playable through the same paths as a catalog item. */
export function channelFromFavoriteSnapshot(snapshot: FavoriteSnapshot): Channel {
  const { streamUrl, ...rest } = snapshot
  return { ...rest, streamUrl: streamUrl ?? '' }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A persisted snapshot of any shape, or null when it cannot render a card. */
export function sanitizeFavoriteSnapshot(raw: unknown): FavoriteSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = optionalString(input.id)
  const name = optionalString(input.name)
  const sourceId = optionalString(input.sourceId)
  const type = input.type as Channel['type']
  if (!id || !name || !sourceId || !CONTENT_TYPES.has(type)) return null

  const snapshot: FavoriteSnapshot = { id, name, sourceId, type }
  const streamId = optionalId(input.streamId)
  const seriesId = optionalId(input.seriesId)
  if (streamId !== undefined) snapshot.streamId = streamId
  if (seriesId !== undefined) snapshot.seriesId = seriesId
  // A URL on an Xtream item could only be a credential-bearing one.
  const streamUrl = optionalString(input.streamUrl)
  if (streamId === undefined && seriesId === undefined) {
    if (!streamUrl || !/^https?:\/\//i.test(streamUrl.trim())) return null
    snapshot.streamUrl = streamUrl
  }
  for (const key of ['containerExtension', 'logo', 'coverUrl', 'categoryId', 'categoryName', 'rating', 'year'] as const) {
    const value = optionalString(input[key])
    if (value !== undefined) snapshot[key] = value
  }
  return snapshot
}

export interface FavoritesSlice {
  favoriteIds: Set<string>
  /** Snapshot per favourite id; persisted with the ids. */
  favoriteSnapshots: Record<string, FavoriteSnapshot>
  /**
   * Adds or removes a favourite. `item` is what the caller shows; without it
   * the catalog record is used, so the snapshot is as fresh as the list.
   */
  toggleFavorite: (channelId: string, item?: Channel) => void
  isFavorite: (channelId: string) => boolean
}

export function createFavoritesSliceFor(
  catalog: CatalogStore
): StateCreator<FavoritesSlice, [], [], FavoritesSlice> {
  return (set, get) => ({
    favoriteIds: new Set<string>(),
    favoriteSnapshots: {},

    toggleFavorite: (channelId, item) =>
      set((state) => {
        const next = new Set(state.favoriteIds)
        const snapshots = { ...state.favoriteSnapshots }
        if (next.has(channelId)) {
          next.delete(channelId)
          delete snapshots[channelId]
        } else {
          next.add(channelId)
          const source = item && item.id === channelId ? item : catalog.getItem(channelId)
          if (source) snapshots[channelId] = favoriteSnapshotOf(source)
        }
        return { favoriteIds: next, favoriteSnapshots: snapshots }
      }),

    isFavorite: (channelId) => get().favoriteIds.has(channelId)
  })
}

export const createFavoritesSlice = createFavoritesSliceFor(defaultCatalog)
