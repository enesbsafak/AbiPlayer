import type { StateCreator } from 'zustand'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import type { Channel } from '@/types/playlist'
import { isAddonId } from '../../../shared/playback'

const CONTENT_TYPES = new Set<Channel['type']>(['live', 'vod', 'series'])

/**
 * Enough of a favourite to render its card and start it when its catalog is
 * not in memory (after a restart, before the full sync; an inactive source).
 * No URL and no credential: Xtream items keep their ids and are rebuilt from
 * the source; an M3U entry (`m3u: true`) keeps its catalog id and gets its URL
 * from the playlist once that is loaded, since playlist URLs usually hold the
 * account password too.
 */
export interface FavoriteSnapshot {
  id: string
  name: string
  sourceId: string
  type: Channel['type']
  streamId?: number
  seriesId?: number
  /** An M3U entry: played by looking its id up in the loaded playlist. */
  m3u?: true
  /** An add-on film or series: its meta id (it opens its detail; its stream is chosen there). */
  addonMetaId?: string
  containerExtension?: string
  logo?: string
  coverUrl?: string
  categoryId?: string
  categoryName?: string
  rating?: string
  year?: string
}

function isHttpUrlText(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
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
  if (isAddonId(channel.addonMetaId)) snapshot.addonMetaId = channel.addonMetaId
  else if (!isXtream && isHttpUrlText(channel.streamUrl)) snapshot.m3u = true
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

/**
 * The card a snapshot renders. Xtream items play through the same paths as a
 * catalog item; an M3U card has no URL until its playlist is loaded
 * (`isM3uSnapshotChannel`).
 */
export function channelFromFavoriteSnapshot(snapshot: FavoriteSnapshot): Channel {
  const { m3u: _m3u, ...rest } = snapshot
  return { ...rest, streamUrl: '' }
}

/** A card for an M3U entry whose playlist is not loaded: it needs the URL looked up before playing. */
export function isM3uSnapshotChannel(channel: Channel): boolean {
  return (
    typeof channel.streamId !== 'number' &&
    typeof channel.seriesId !== 'number' &&
    channel.addonMetaId === undefined &&
    !channel.streamUrl
  )
}

/**
 * Persist v3: snapshots no longer hold the M3U entry URL; one that had an
 * http(s) entry URL and no Xtream id is marked `m3u` instead. Pure and
 * idempotent; anything that is not a snapshot passes through (merge validates
 * the rest).
 */
export function stripSnapshotStreamUrls(snapshots: unknown): unknown {
  if (!Array.isArray(snapshots)) return snapshots
  return snapshots.map((raw) => {
    if (!raw || typeof raw !== 'object' || !('streamUrl' in raw)) return raw
    const { streamUrl, ...rest } = raw as Record<string, unknown>
    const hasXtreamId = typeof rest.streamId === 'number' || typeof rest.seriesId === 'number'
    return !hasXtreamId && isHttpUrlText(streamUrl) ? { ...rest, m3u: true } : rest
  })
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
  // No URL is ever kept: an Xtream one would carry the credentials, an M3U
  // entry is found again by its id in the loaded playlist, and an add-on item
  // is opened by its meta id. A snapshot that is none of these cannot be played.
  if (streamId === undefined && seriesId === undefined) {
    if (isAddonId(input.addonMetaId)) snapshot.addonMetaId = input.addonMetaId
    else if (input.m3u === true) snapshot.m3u = true
    else return null
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
          const record = catalog.getItem(channelId)
          const shown = item && item.id === channelId ? item : undefined
          // A card drawn from a snapshot has no URL; its M3U entry keeps the marker.
          if (shown && isM3uSnapshotChannel(shown) && !record) snapshots[channelId] = { ...favoriteSnapshotOf(shown), m3u: true }
          else {
            const source = shown && !isM3uSnapshotChannel(shown) ? shown : (record ?? shown)
            if (source) snapshots[channelId] = favoriteSnapshotOf(source)
          }
        }
        return { favoriteIds: next, favoriteSnapshots: snapshots }
      }),

    isFavorite: (channelId) => get().favoriteIds.has(channelId)
  })
}

export const createFavoritesSlice = createFavoritesSliceFor(defaultCatalog)
