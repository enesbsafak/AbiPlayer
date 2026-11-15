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
  return runCatalogSearch(store, rawQuery, settings, limit, false).items
}

export interface CatalogSearchResult {
  /** At most `limit` matches, clean ones first (as `searchCatalog`). */
  items: CatalogItem[]
  /** Every match, not capped. */
  total: number
}

/** `searchCatalog` plus the true number of matches, for "N sonuç" next to a capped list. */
export function searchCatalogWithTotal(
  store: CatalogStore,
  rawQuery: string,
  settings: CatalogViewSettings,
  limit: number
): CatalogSearchResult {
  return runCatalogSearch(store, rawQuery, settings, limit, true)
}

function runCatalogSearch(
  store: CatalogStore,
  rawQuery: string,
  settings: CatalogViewSettings,
  limit: number,
  countAll: boolean
): CatalogSearchResult {
  const query = normalizeSearchKey(rawQuery)
  if (!query) return { items: [], total: 0 }
  const clean: CatalogItem[] = []
  const adult: CatalogItem[] = []
  let total = 0

  scan: for (const status of store.getStatuses()) {
    if (!countAll && clean.length >= limit) break
    const adultCategoryIds = store.getAdultCategoryIds(status.sourceId, status.type)
    for (const item of store.getVisibleItems(status.sourceId, status.type, settings)) {
      if (!matchesSearch(item, query, true)) continue
      total += 1
      const isAdult = item.isAdult || (!!item.categoryId && adultCategoryIds.has(item.categoryId))
      if (isAdult) {
        if (adult.length < limit) adult.push(item)
      } else if (clean.length < limit) {
        clean.push(item)
        if (!countAll && clean.length >= limit) break scan
      }
    }
  }

  const items = clean.length >= limit ? clean.slice(0, limit) : clean.concat(adult).slice(0, limit)
  return { items, total }
}
