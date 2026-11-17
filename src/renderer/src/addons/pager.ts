import { useSyncExternalStore } from 'react'
import { useStore } from '@/store'
import type { CatalogType } from '@/catalog/types'
import { resolveTmdbApiKey } from '@/services/tmdb-api'
import type { PlaylistSource } from '@/types/playlist'
import { catalogSourceReady } from './builtin'
import { createAddonCatalogPager, type AddonCategoryPaging } from './catalog'
import { catalogProviderFor, type AddonCatalogProvider } from './provider'

/** The TMDB key saved in Ayarlar (it lives in memory, read from the secure store), or null. */
export function currentTmdbApiKey(): string | null {
  return resolveTmdbApiKey(useStore.getState().settings.tmdbApiKey)
}

/** The app's provider for a catalogue source (provider.ts), with the TMDB key saved now. */
export function appCatalogProvider(source: PlaylistSource | null | undefined): AddonCatalogProvider | null {
  return catalogProviderFor(source, { tmdbApiKey: currentTmdbApiKey() })
}

/** The app's pager: pages go into the app's catalog, sources come from the app's store. */
export const addonCatalogPager = createAddonCatalogPager({
  getSource: (sourceId) => useStore.getState().sources.find((source) => source.id === sourceId),
  getProvider: appCatalogProvider
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

/**
 * Whether a catalogue source can ask for pages and metas now: an add-on once
 * its address is in memory, the TMDB catalogue while a TMDB key is saved.
 */
export function useCatalogSourceReady(sourceId: string | null | undefined): boolean {
  return useStore((s) =>
    catalogSourceReady(
      sourceId ? s.sources.find((source) => source.id === sourceId) : null,
      resolveTmdbApiKey(s.settings.tmdbApiKey)
    )
  )
}
