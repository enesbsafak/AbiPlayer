import type { StateCreator } from 'zustand'
import type { Channel, Category } from '@/types/playlist'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { categoryToRecord, toCatalogItem } from '@/catalog/convert'
import type {
  CatalogCategory,
  CatalogItem,
  CatalogStatus,
  CatalogType,
  SourceCatalogReplacement
} from '@/catalog/types'

type ContentType = CatalogType

export interface SyncProgress {
  /** Which type is currently being synced */
  currentType: ContentType | null
  /** How many types completed out of 3 */
  completedTypes: number
  /** Is sync actively running */
  active: boolean
}

/** `catalogStatus[sourceId][type]`, mirrored from the catalog store on every change. */
export type CatalogStatusMap = Record<string, Partial<Record<ContentType, CatalogStatus>>>

/** `selectedCategoryIds[sourceId][type]`: the category browsed on each catalog page. */
export type CategorySelectionMap = Record<string, Partial<Record<ContentType, string>>>

/** The category browsed for one (source, type), or null for "all". */
export function selectedCategoryFor(
  selection: CategorySelectionMap,
  sourceId: string | null | undefined,
  type: ContentType
): string | null {
  return sourceId ? (selection[sourceId]?.[type] ?? null) : null
}

function withSelection(
  map: CategorySelectionMap,
  sourceId: string,
  type: ContentType,
  categoryId: string | null
): CategorySelectionMap {
  const current = map[sourceId]
  if ((current?.[type] ?? null) === categoryId) return map
  const nextSource = { ...current }
  if (categoryId) nextSource[type] = categoryId
  else delete nextSource[type]
  const next = { ...map }
  if (Object.keys(nextSource).length > 0) next[sourceId] = nextSource
  else delete next[sourceId]
  return next
}

/** Drops every selection pointing at `categoryId`. */
function withoutCategory(map: CategorySelectionMap, categoryId: string): CategorySelectionMap {
  let next = map
  for (const [sourceId, byType] of Object.entries(map)) {
    for (const type of ['live', 'vod', 'series'] as const) {
      if (byType[type] === categoryId) next = withSelection(next, sourceId, type, null)
    }
  }
  return next
}

export interface PlaylistSlice {
  /**
   * Per-(source, type) catalog status: loaded, complete, syncing, error,
   * version, count. The data itself lives in the catalog store
   * (`@/catalog`); this mirror lets selectors and effects depend on it.
   */
  catalogStatus: CatalogStatusMap
  syncProgress: Record<string, SyncProgress>
  /** Categories the user chose to hide; their channels drop out of every list. */
  hiddenCategoryIds: Set<string>
  /**
   * The category browsed per source and content type, so a category picked on
   * Live TV never filters Films or Series (F1-20). Session state, not persisted.
   */
  selectedCategoryIds: CategorySelectionMap
  isLoadingPlaylist: boolean
  /**
   * @deprecated Merges channels into the catalog as partial batches. Kept for
   * callers that still hold parsed `Channel` lists; new code commits through
   * `replaceSourceCatalog` or the catalog store.
   */
  addChannels: (channels: Channel[]) => void
  /** @deprecated Merges categories into the catalog; see `addChannels`. */
  addCategories: (categories: Category[]) => void
  /**
   * The one path for a source refresh: cancels the source's running syncs and
   * swaps in the given complete lists, or (null) keeps the items on screen but
   * marks them incomplete so the next visit re-syncs and replaces them. Hidden
   * category choices are kept. Returns false, changing nothing, when
   * `expectedRevision` is given and the source was removed or refreshed since.
   */
  replaceSourceCatalog: (
    sourceId: string,
    replacement: SourceCatalogReplacement | null,
    expectedRevision?: number
  ) => boolean
  /** A deleted source: drops its catalog and status, cancels its syncs, forgets its hidden categories. */
  removeSourceCatalog: (sourceId: string) => void
  /** Selects the category browsed for (source, type); null shows every category. */
  setSelectedCategory: (sourceId: string, type: ContentType, id: string | null) => void
  setSyncProgress: (sourceId: string, progress: SyncProgress | null) => void
  toggleCategoryHidden: (categoryId: string) => void
  setHiddenCategories: (ids: string[]) => void
  /** Unhides every category, or only those belonging to one source. */
  showAllCategories: (sourceId?: string) => void
  setPlaylistLoading: (loading: boolean) => void
}

function withStatus(map: CatalogStatusMap, sourceId: string, type: ContentType, status: CatalogStatus | null): CatalogStatusMap {
  const current = map[sourceId]
  if ((current?.[type] ?? null) === status) return map
  const nextSource = { ...current }
  if (status) nextSource[type] = status
  else delete nextSource[type]
  const next = { ...map }
  if (Object.keys(nextSource).length > 0) next[sourceId] = nextSource
  else delete next[sourceId]
  return next
}

/** Category ids of a source: those in the catalog plus any with the source's id prefix. */
function belongsToSource(catalog: CatalogStore, sourceId: string): (categoryId: string) => boolean {
  const known = new Set<string>()
  for (const type of ['live', 'vod', 'series'] as const) {
    for (const category of catalog.getCategories(sourceId, type)) known.add(category.id)
  }
  // Every category id the converters produce starts with `<sourceId>_`, so
  // hidden flags of categories not loaded this session are found too.
  const prefix = `${sourceId}_`
  return (categoryId) => known.has(categoryId) || categoryId.startsWith(prefix)
}

function groupByPartition<T extends { sourceId: string; type: ContentType }>(list: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const entry of list) {
    const key = `${entry.type}\n${entry.sourceId}`
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }
  return groups
}

export function createPlaylistSliceFor(
  catalog: CatalogStore
): StateCreator<PlaylistSlice, [], [], PlaylistSlice> {
  return (set) => {
    catalog.subscribe(({ sourceId, type }) => {
      set((state) => {
        const next = withStatus(state.catalogStatus, sourceId, type, catalog.getStatus(sourceId, type))
        return next === state.catalogStatus ? state : { catalogStatus: next }
      })
    })

    return {
      catalogStatus: {},
      syncProgress: {},
      hiddenCategoryIds: new Set<string>(),
      selectedCategoryIds: {},
      isLoadingPlaylist: false,

      addChannels: (channels) => {
        for (const group of groupByPartition(channels).values()) {
          const items: CatalogItem[] = group.map(toCatalogItem)
          const token = catalog.beginGeneration(group[0].sourceId, group[0].type)
          catalog.commit({ token, mode: 'partial', items })
        }
      },

      addCategories: (categories) => {
        for (const group of groupByPartition(categories).values()) {
          const { sourceId, type } = group[0]
          const merged: CatalogCategory[] = [...catalog.getCategories(sourceId, type)]
          const known = new Set(merged.map((category) => category.id))
          for (const category of group) {
            if (known.has(category.id)) continue
            known.add(category.id)
            merged.push(categoryToRecord(category))
          }
          const token = catalog.beginGeneration(sourceId, type)
          catalog.commit({ token, mode: 'partial', categories: merged })
        }
      },

      replaceSourceCatalog: (sourceId, replacement, expectedRevision) =>
        catalog.replaceSource(sourceId, replacement, expectedRevision),

      removeSourceCatalog: (sourceId) => {
        // Read before the categories are dropped.
        const isSourceCategory = belongsToSource(catalog, sourceId)
        catalog.removeSource(sourceId)
        set((state) => {
          // Drop this source's hidden entries too, otherwise removing and
          // re-adding a source resurrects hidden flags for ids the user no
          // longer recognises (M3U category ids are name hashes).
          let nextHidden: Set<string> | null = null
          for (const id of state.hiddenCategoryIds) {
            if (!isSourceCategory(id)) continue
            nextHidden ??= new Set(state.hiddenCategoryIds)
            nextHidden.delete(id)
          }
          const nextProgress = { ...state.syncProgress }
          delete nextProgress[sourceId]
          let nextSelection = state.selectedCategoryIds
          if (sourceId in nextSelection) {
            nextSelection = { ...nextSelection }
            delete nextSelection[sourceId]
          }
          return {
            syncProgress: nextProgress,
            selectedCategoryIds: nextSelection,
            ...(nextHidden ? { hiddenCategoryIds: nextHidden } : {})
          }
        })
      },

      setSelectedCategory: (sourceId, type, id) =>
        set((state) => {
          const next = withSelection(state.selectedCategoryIds, sourceId, type, id)
          return next === state.selectedCategoryIds ? state : { selectedCategoryIds: next }
        }),

      setSyncProgress: (sourceId, progress) =>
        set((state) => {
          const next = { ...state.syncProgress }
          if (progress) {
            next[sourceId] = progress
          } else {
            if (!(sourceId in next)) return state
            delete next[sourceId]
          }
          return { syncProgress: next }
        }),

      toggleCategoryHidden: (categoryId) =>
        set((state) => {
          const next = new Set(state.hiddenCategoryIds)
          if (next.has(categoryId)) {
            next.delete(categoryId)
            return { hiddenCategoryIds: next }
          }

          next.add(categoryId)
          // Hiding the category the user is currently browsing would leave them
          // staring at an empty grid with no way back, so fall back to "all".
          const selection = withoutCategory(state.selectedCategoryIds, categoryId)
          return selection === state.selectedCategoryIds
            ? { hiddenCategoryIds: next }
            : { hiddenCategoryIds: next, selectedCategoryIds: selection }
        }),

      setHiddenCategories: (ids) => set({ hiddenCategoryIds: new Set(ids) }),

      showAllCategories: (sourceId) =>
        set((state) => {
          if (!sourceId) {
            if (state.hiddenCategoryIds.size === 0) return state
            return { hiddenCategoryIds: new Set<string>() }
          }

          const isSourceCategory = belongsToSource(catalog, sourceId)
          const next = new Set<string>()
          for (const id of state.hiddenCategoryIds) {
            if (!isSourceCategory(id)) next.add(id)
          }
          if (next.size === state.hiddenCategoryIds.size) return state
          return { hiddenCategoryIds: next }
        }),

      setPlaylistLoading: (loading) => set({ isLoadingPlaylist: loading })
    }
  }
}

export const createPlaylistSlice = createPlaylistSliceFor(defaultCatalog)
