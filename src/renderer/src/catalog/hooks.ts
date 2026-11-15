import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useStore } from '@/store'
import { catalog, type CategoryViewRequest } from './catalog-store'
import { searchCatalog } from './search'
import type {
  CatalogCategory,
  CatalogItem,
  CatalogStatus,
  CatalogType,
  CatalogViewSettings
} from './types'

const EMPTY_ITEMS: readonly CatalogItem[] = Object.freeze([]) as readonly CatalogItem[]
const EMPTY_CATEGORIES: readonly CatalogCategory[] = Object.freeze([]) as readonly CatalogCategory[]
const noop = (): void => undefined
const subscribeNothing = (): (() => void) => noop

/*
 * Every hook subscribes to exactly the (source, type) it reads, and every
 * snapshot is cached in the catalog store, so a write to films never
 * re-renders a screen that shows live channels, and eight screens showing the
 * same slice share one filtered list.
 */

function usePartitionSubscription(sourceId: string | null | undefined, type: CatalogType) {
  return useCallback(
    (listener: () => void) => (sourceId ? catalog.subscribePartition(sourceId, type, listener) : noop),
    [sourceId, type]
  )
}

/** The user's hidden categories and the adult-content setting, as one stable object. */
export function useCatalogViewSettings(): CatalogViewSettings {
  const hiddenCategoryIds = useStore((s) => s.hiddenCategoryIds)
  const showAdultContent = useStore((s) => s.settings.showAdultContent)
  return useMemo(() => ({ hiddenCategoryIds, showAdultContent }), [hiddenCategoryIds, showAdultContent])
}

/** Status of one (source, type), from the zustand mirror. */
export function useCatalogStatus(sourceId: string | null | undefined, type: CatalogType): CatalogStatus | null {
  return useStore((s) => (sourceId ? (s.catalogStatus[sourceId]?.[type] ?? null) : null))
}

/** Every record of one (source, type), in provider order, before any view rule. */
export function useCatalogItems(sourceId: string | null | undefined, type: CatalogType): readonly CatalogItem[] {
  const subscribe = usePartitionSubscription(sourceId, type)
  const getSnapshot = useCallback(
    () => (sourceId ? catalog.getItems(sourceId, type) : EMPTY_ITEMS),
    [sourceId, type]
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Every category of one (source, type), before any view rule. */
export function useCatalogCategories(
  sourceId: string | null | undefined,
  type: CatalogType
): readonly CatalogCategory[] {
  const subscribe = usePartitionSubscription(sourceId, type)
  const getSnapshot = useCallback(
    () => (sourceId ? catalog.getCategories(sourceId, type) : EMPTY_CATEGORIES),
    [sourceId, type]
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * The records the user sees: hidden categories dropped, adult content hidden
 * or listed last per the setting. `categoryId` narrows to one category.
 */
export function useVisibleCatalogItems(
  sourceId: string | null | undefined,
  type: CatalogType,
  categoryId?: string | null
): readonly CatalogItem[] {
  const settings = useCatalogViewSettings()
  const subscribe = usePartitionSubscription(sourceId, type)
  const getSnapshot = useCallback(
    () => (sourceId ? catalog.getVisibleItems(sourceId, type, settings, categoryId) : EMPTY_ITEMS),
    [sourceId, type, settings, categoryId]
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** The category list the user sees; `includeHidden` for the settings screen. */
export function useVisibleCatalogCategories(
  sourceId: string | null | undefined,
  type: CatalogType,
  request: CategoryViewRequest = {}
): readonly CatalogCategory[] {
  const settings = useCatalogViewSettings()
  const includeHidden = request.includeHidden === true
  const subscribe = usePartitionSubscription(sourceId, type)
  const getSnapshot = useCallback(
    () =>
      sourceId ? catalog.getVisibleCategories(sourceId, type, settings, { includeHidden }) : EMPTY_CATEGORIES,
    [sourceId, type, settings, includeHidden]
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Increases with every catalog change; for the few views that span sources. */
export function useCatalogVersion(): number {
  return useSyncExternalStore(catalog.subscribe, catalog.getVersion)
}

/** One record by id, wherever it lives; undefined while it is not in memory. */
export function useCatalogItem(id: string | null | undefined): CatalogItem | undefined {
  const getSnapshot = useCallback(() => (id ? catalog.getItem(id) : undefined), [id])
  return useSyncExternalStore(id ? catalog.subscribe : subscribeNothing, getSnapshot)
}

/** `searchCatalog` over every source, recomputed when the query, the settings or the catalog change. */
export function useCatalogSearch(query: string, limit: number): CatalogItem[] {
  const settings = useCatalogViewSettings()
  const version = useCatalogVersion()
  return useMemo(() => {
    void version
    return searchCatalog(catalog, query, settings, limit)
  }, [query, settings, limit, version])
}
