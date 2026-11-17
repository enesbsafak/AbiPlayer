import { useSyncExternalStore } from 'react'
import { useStore } from '@/store'
import type { CatalogType } from '@/catalog/types'
import { createAddonCatalogPager, type AddonCategoryPaging } from './catalog'

/** The app's pager: pages go into the app's catalog, sources come from the app's store. */
export const addonCatalogPager = createAddonCatalogPager({
  getSource: (sourceId) => useStore.getState().sources.find((source) => source.id === sourceId)
})

/** Where paging of one add-on category stands, or null before its first page was asked for. */
export function useAddonCategoryPaging(
  sourceId: string | null,
  type: CatalogType,
  categoryId: string | null
): AddonCategoryPaging | null {
  return useSyncExternalStore(addonCatalogPager.subscribe, () =>
    sourceId && categoryId ? addonCatalogPager.getPaging(sourceId, type, categoryId) : null
  )
}
