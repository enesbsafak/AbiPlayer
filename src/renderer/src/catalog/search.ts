import { normalizeSearchKey } from './normalize'
import type { CatalogStore } from './catalog-store'
import type { CatalogItem, CatalogViewSettings } from './types'

/** `query` must already be normalized (`normalizeSearchKey`). */
export function matchesSearch(item: CatalogItem, query: string, includeGroup = false): boolean {
  if (item.searchName.includes(query)) return true
  return includeGroup && !!item.searchGroup && item.searchGroup.includes(query)
}

/**
 * Items whose name (and, with `includeGroup`, group) contains the query. A
 * substring scan over text normalized at ingest: no locale call per item.
 * Stops after `limit` matches when one is given.
 */
export function filterBySearch<T extends CatalogItem>(
  items: readonly T[],
  rawQuery: string,
  options: { includeGroup?: boolean; limit?: number } = {}
): readonly T[] {
  const query = normalizeSearchKey(rawQuery)
  if (!query) return items
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const result: T[] = []
  for (const item of items) {
    if (!matchesSearch(item, query, options.includeGroup)) continue
    result.push(item)
    if (result.length >= limit) break
  }
  return result
}

/**
 * Search across every source and type, on the same view the lists show
 * (hidden categories out, adult content per the setting). Clean matches come
 * before adult ones, so which `limit` results survive does not depend on the
 * order the sources were loaded in.
 */
export function searchCatalog(
  store: CatalogStore,
  rawQuery: string,
  settings: CatalogViewSettings,
  limit: number
): CatalogItem[] {
  const query = normalizeSearchKey(rawQuery)
  if (!query) return []
  const clean: CatalogItem[] = []
  const adult: CatalogItem[] = []

  for (const status of store.getStatuses()) {
    if (clean.length >= limit) break
    const adultCategoryIds = store.getAdultCategoryIds(status.sourceId, status.type)
    for (const item of store.getVisibleItems(status.sourceId, status.type, settings)) {
      if (!matchesSearch(item, query, true)) continue
      const isAdult = item.isAdult || (!!item.categoryId && adultCategoryIds.has(item.categoryId))
      if (isAdult) {
        if (adult.length < limit) adult.push(item)
      } else {
        clean.push(item)
        if (clean.length >= limit) break
      }
    }
  }

  return clean.length >= limit ? clean.slice(0, limit) : clean.concat(adult).slice(0, limit)
}
