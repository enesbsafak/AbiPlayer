/**
 * Add-on sources (Stremio add-on protocol): a third kind of content source
 * next to Xtream and M3U, behind the experimental `addonSourcesEnabled`
 * setting. An add-on's base address and every stream URL are secrets; see
 * address.ts and stream-registry.ts. The built-in TMDB catalogue is a
 * catalogue source of the same kind (builtin.ts, tmdb.ts, provider.ts).
 */
export * from './address'
export * from './client'
export * from './manifest'
export * from './catalog'
export * from './detail'
export * from './stream-registry'
export * from './streams'
export * from './connect'
export * from './messages'
export * from './builtin'
export * from './provider'
export * from './search'
export {
  addonCatalogPager,
  appCatalogProvider,
  currentTmdbApiKey,
  useAddonCategoryPaging,
  useCatalogSourceReady
} from './pager'
