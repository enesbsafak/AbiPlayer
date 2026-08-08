import { useMemo } from 'react'
import { useStore } from '@/store'
import { collectAdultCategoryIds } from '@/services/adult-content'
import type { CatalogViewOptions } from '@/services/catalog-view'

/**
 * The options every catalog list needs, resolved once.
 *
 * Eight screens filter and sort the same catalog. Without this each of them
 * would re-derive the adult-category set from the full category list, and the
 * next filter added would have to be wired into all eight by hand.
 */
export function useCatalogView(): CatalogViewOptions {
  const categories = useStore((s) => s.categories)
  const hiddenCategoryIds = useStore((s) => s.hiddenCategoryIds)
  const sortMode = useStore((s) => s.settings.catalogSortMode)

  const adultCategoryIds = useMemo(() => collectAdultCategoryIds(categories), [categories])

  return useMemo(
    () => ({ hiddenCategoryIds, adultCategoryIds, sortMode }),
    [hiddenCategoryIds, adultCategoryIds, sortMode]
  )
}
