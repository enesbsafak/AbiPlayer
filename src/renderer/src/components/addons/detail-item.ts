import { useMemo } from 'react'
import { useStore } from '@/store'
import { useCatalogItem } from '@/catalog'
import { channelFromFavoriteSnapshot, type FavoriteSnapshot } from '@/store/favorites-slice'
import type { CatalogDetailRef } from '@/hooks/catalog-page-state'
import type { Channel } from '@/types/playlist'

/**
 * The item an open detail shows. The record as it was clicked wins (a later
 * sync replaces the catalog object, which must not reload the detail on
 * screen), then the catalog record. An add-on item can be opened before its
 * catalogue page is in memory (from Favoriler after a restart, from another
 * source's favourite): then its favourite snapshot stands in, or a bare
 * record with its meta id, whose detail fills in from the add-on.
 */
export function resolveDetailItem(
  detail: CatalogDetailRef | null,
  type: 'vod' | 'series',
  opened: Channel | null,
  catalogItem: Channel | undefined,
  snapshot: FavoriteSnapshot | undefined
): Channel | null {
  if (!detail) return null
  if (opened?.id === detail.itemId) return opened
  if (catalogItem) return catalogItem
  if (detail.addonMetaId === undefined) return null
  if (snapshot) return channelFromFavoriteSnapshot(snapshot)
  return {
    id: detail.itemId,
    name: '',
    streamUrl: '',
    sourceId: detail.sourceId,
    type,
    addonMetaId: detail.addonMetaId
  }
}

export function useAddonDetailItem(
  detail: CatalogDetailRef | null,
  type: 'vod' | 'series',
  opened: Channel | null
): Channel | null {
  const detailId = detail?.itemId ?? null
  const catalogItem = useCatalogItem(detailId)
  const snapshot = useStore((s) => (detailId ? s.favoriteSnapshots[detailId] : undefined))
  return useMemo(
    () => resolveDetailItem(detail, type, opened, catalogItem, snapshot),
    [detail, type, opened, catalogItem, snapshot]
  )
}
