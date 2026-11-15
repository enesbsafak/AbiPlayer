// Store slices import from './catalog-store' and './convert' directly: this
// barrel also exports the React hooks, which import the zustand store.
export * from './types'
export { catalog, createCatalogStore, type CatalogStore, type CategoryViewRequest, type SyncStatePatch } from './catalog-store'
export * from './convert'
export { normalizeSearchKey } from './normalize'
export { toCatalogSyncError } from './sync-error'
export { matchesSearch, filterBySearch, searchCatalog } from './search'
export * from './hooks'
