import { applyCatalogView, applyCategoryView } from '@/services/catalog-view'
import {
  CATALOG_TYPES,
  type CatalogCategory,
  type CatalogChange,
  type CatalogCommit,
  type CatalogItem,
  type CatalogListOrigin,
  type CatalogListener,
  type CatalogStatus,
  type CatalogSyncError,
  type CatalogType,
  type CatalogViewSettings,
  type CommitResult,
  type GenerationToken,
  type SourceCatalogReplacement
} from './types'

const EMPTY_ITEMS: readonly CatalogItem[] = Object.freeze([]) as readonly CatalogItem[]
const EMPTY_CATEGORIES: readonly CatalogCategory[] = Object.freeze([]) as readonly CatalogCategory[]
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

export interface CategoryViewRequest {
  /** Keep hidden (and adult) categories: the settings screen lists them to offer them back. */
  includeHidden?: boolean
}

export interface SyncStatePatch {
  syncing?: boolean
  error?: CatalogSyncError | null
}

/**
 * `commit({ mode: 'replace' })` for a complete list that arrives in chunks
 * (from the worker or the disk cache). The chunks are collected and indexed
 * out of sight as they come; `finish` swaps them in at once under exactly the
 * guard of `commit`, so nothing is shown half-loaded and a stale or overtaken
 * session changes nothing.
 */
export interface StagedReplace {
  readonly token: GenerationToken
  /** Items so far, after dropping repeated ids. */
  readonly count: number
  append(items: readonly CatalogItem[]): void
  finish(options?: { categories?: readonly CatalogCategory[]; origin?: CatalogListOrigin }): CommitResult
}

/**
 * The normalized catalog, outside zustand. One partition per (source, type)
 * holds the ordered records, an id index and the category list; per-category
 * lists, adult-category sets and the filtered views are derived lazily and
 * cached per partition version, so every screen showing the same slice shares
 * one computation.
 *
 * Writes go through `commit` (one generation of one partition), `replaceSource`
 * and `removeSource`. Each write notifies only the listeners of the partitions
 * it changed, plus the global listeners.
 */
export interface CatalogStore {
  /** Revision of a source; bumped by `replaceSource` and `removeSource`. */
  getSourceRevision(sourceId: string): number
  /** A token for one sync or fetch of (source, type). Take it before the request starts. */
  beginGeneration(sourceId: string, type: CatalogType): GenerationToken
  /** False once the token's source was removed or refreshed. */
  isTokenCurrent(token: GenerationToken): boolean
  /** Aborted when the source is removed or refreshed: pass it to the requests of a sync. */
  sourceSignal(sourceId: string): AbortSignal

  /** The single write path for generations (see `CatalogCommit`). */
  commit(commit: CatalogCommit): CommitResult
  /** A `replace` commit fed in chunks; see `StagedReplace`. */
  beginReplace(token: GenerationToken): StagedReplace
  /** Sync state of the token's partition; ignored for a stale or overtaken token. */
  setSyncState(token: GenerationToken, patch: SyncStatePatch): boolean
  /**
   * Swaps a whole source in one step and cancels its running syncs. With a
   * replacement, every type gets the given complete lists (missing types become
   * empty). With null, the items stay on screen but every type is marked
   * incomplete, so the next visit runs a full sync that replaces them.
   * `expectedRevision`: drop the swap (return false) when the source was
   * removed or refreshed after the caller started fetching.
   */
  replaceSource(sourceId: string, replacement: SourceCatalogReplacement | null, expectedRevision?: number): boolean
  /** Drops a source's data and status and cancels its syncs. */
  removeSource(sourceId: string): void
  /** Empties the store (tests). Revisions keep counting so old tokens stay dead. */
  reset(): void

  getStatus(sourceId: string, type: CatalogType): CatalogStatus | null
  getStatuses(): CatalogStatus[]
  getSourceIds(): string[]
  getItems(sourceId: string, type: CatalogType): readonly CatalogItem[]
  getCategories(sourceId: string, type: CatalogType): readonly CatalogCategory[]
  getItem(id: string): CatalogItem | undefined
  getCategoryItems(sourceId: string, type: CatalogType, categoryId: string): readonly CatalogItem[]
  /** The whole category is in memory: the list is complete, or that category was fetched. */
  isCategoryLoaded(sourceId: string, type: CatalogType, categoryId: string): boolean
  getAdultCategoryIds(sourceId: string, type: CatalogType): ReadonlySet<string>
  /** Items after hidden categories and the adult-content setting; optionally one category. */
  getVisibleItems(
    sourceId: string,
    type: CatalogType,
    settings: CatalogViewSettings,
    categoryId?: string | null
  ): readonly CatalogItem[]
  getVisibleCategories(
    sourceId: string,
    type: CatalogType,
    settings: CatalogViewSettings,
    request?: CategoryViewRequest
  ): readonly CatalogCategory[]
  /** Increases with every change anywhere. */
  getVersion(): number

  subscribe(listener: CatalogListener): () => void
  subscribePartition(sourceId: string, type: CatalogType, listener: CatalogListener): () => void
}

interface Derived {
  version: number
  byCategory: Map<string, CatalogItem[]> | null
  adultCategoryIds: Set<string> | null
  viewHidden: ReadonlySet<string> | null
  viewAdult: boolean
  views: Map<string, readonly CatalogItem[]>
  categoryViews: Map<string, readonly CatalogCategory[]>
}

interface Partition {
  key: string
  sourceId: string
  type: CatalogType
  items: readonly CatalogItem[]
  /** id -> index in `items`. */
  idIndex: Map<string, number>
  categories: readonly CatalogCategory[]
  loadedCategoryIds: Set<string>
  status: CatalogStatus
  /** Generation of the last complete list; older item batches are dropped. */
  itemsGeneration: number
  /** Generation of the last category list; older lists are dropped. */
  categoriesGeneration: number
  derived: Derived | null
}

function partitionKey(sourceId: string, type: CatalogType): string {
  return `${type}\n${sourceId}`
}

const ALL_KEY = '\u0000all'

function uniqueCategories(categories: readonly CatalogCategory[]): CatalogCategory[] {
  const seen = new Set<string>()
  const list: CatalogCategory[] = []
  for (const category of categories) {
    if (seen.has(category.id)) continue
    seen.add(category.id)
    list.push(category)
  }
  return list
}

export function createCatalogStore(): CatalogStore {
  const partitions = new Map<string, Partition>()
  const revisions = new Map<string, number>()
  const controllers = new Map<string, AbortController>()
  const listeners = new Map<string, Set<CatalogListener>>()
  let version = 0
  let generationCounter = 0

  const nextVersion = (): number => {
    version += 1
    return version
  }

  const emit = (sourceId: string, type: CatalogType): void => {
    const change: CatalogChange = { sourceId, type }
    const scoped = listeners.get(partitionKey(sourceId, type))
    if (scoped) for (const listener of [...scoped]) listener(change)
    const all = listeners.get(ALL_KEY)
    if (all) for (const listener of [...all]) listener(change)
  }

  const addListener = (key: string, listener: CatalogListener): (() => void) => {
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      const current = listeners.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listeners.delete(key)
    }
  }

  const revisionOf = (sourceId: string): number => revisions.get(sourceId) ?? 0

  const invalidateSource = (sourceId: string): void => {
    revisions.set(sourceId, revisionOf(sourceId) + 1)
    const controller = controllers.get(sourceId)
    if (controller) {
      controllers.delete(sourceId)
      controller.abort()
    }
  }

  const emptyStatus = (sourceId: string, type: CatalogType): CatalogStatus => ({
    sourceId,
    type,
    version: nextVersion(),
    count: 0,
    loaded: false,
    complete: false,
    categoriesLoaded: false,
    syncing: false,
    error: null,
    fromCache: false,
    fetchedAt: null
  })

  const ensurePartition = (sourceId: string, type: CatalogType): Partition => {
    const key = partitionKey(sourceId, type)
    let partition = partitions.get(key)
    if (!partition) {
      partition = {
        key,
        sourceId,
        type,
        items: EMPTY_ITEMS,
        idIndex: new Map(),
        categories: EMPTY_CATEGORIES,
        loadedCategoryIds: new Set(),
        status: emptyStatus(sourceId, type),
        itemsGeneration: 0,
        categoriesGeneration: 0,
        derived: null
      }
      partitions.set(key, partition)
    }
    return partition
  }

  const getPartition = (sourceId: string, type: CatalogType): Partition | undefined =>
    partitions.get(partitionKey(sourceId, type))

  /** `version` moves only when items or categories change, so derived views survive status-only updates. */
  const updateStatus = (partition: Partition, patch: Partial<CatalogStatus>, dataChanged: boolean): void => {
    const nextGlobal = nextVersion()
    partition.status = {
      ...partition.status,
      ...patch,
      version: dataChanged ? nextGlobal : partition.status.version
    }
  }

  /** Complete list: first occurrence of an id wins, provider order kept. */
  const setAllItems = (partition: Partition, incoming: readonly CatalogItem[]): void => {
    const idIndex = new Map<string, number>()
    const items: CatalogItem[] = []
    for (const item of incoming) {
      if (idIndex.has(item.id)) continue
      idIndex.set(item.id, items.length)
      items.push(item)
    }
    partition.items = items
    partition.idIndex = idIndex
    partition.loadedCategoryIds = new Set()
  }

  /** Partial batch: known ids are updated in place, new ones appended. */
  const upsertItems = (partition: Partition, incoming: readonly CatalogItem[]): void => {
    const items = partition.items.slice()
    const idIndex = partition.idIndex
    const seen = new Set<string>()
    for (const item of incoming) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      const index = idIndex.get(item.id)
      if (index === undefined) {
        idIndex.set(item.id, items.length)
        items.push(item)
      } else {
        items[index] = item
      }
    }
    partition.items = items
  }

  const derivedFor = (partition: Partition): Derived => {
    const current = partition.derived
    if (current && current.version === partition.status.version) return current
    const next: Derived = {
      version: partition.status.version,
      byCategory: null,
      adultCategoryIds: null,
      viewHidden: null,
      viewAdult: false,
      views: new Map(),
      categoryViews: new Map()
    }
    partition.derived = next
    return next
  }

  const viewCacheFor = (partition: Partition, settings: CatalogViewSettings): Derived => {
    const derived = derivedFor(partition)
    if (derived.viewHidden !== settings.hiddenCategoryIds || derived.viewAdult !== settings.showAdultContent) {
      derived.viewHidden = settings.hiddenCategoryIds
      derived.viewAdult = settings.showAdultContent
      derived.views.clear()
      derived.categoryViews.clear()
    }
    return derived
  }

  const adultCategoryIdsOf = (partition: Partition): Set<string> => {
    const derived = derivedFor(partition)
    if (!derived.adultCategoryIds) {
      const ids = new Set<string>()
      for (const category of partition.categories) if (category.isAdult) ids.add(category.id)
      derived.adultCategoryIds = ids
    }
    return derived.adultCategoryIds
  }

  const byCategoryOf = (partition: Partition): Map<string, CatalogItem[]> => {
    const derived = derivedFor(partition)
    if (!derived.byCategory) {
      const map = new Map<string, CatalogItem[]>()
      for (const item of partition.items) {
        if (!item.categoryId) continue
        const list = map.get(item.categoryId)
        if (list) list.push(item)
        else map.set(item.categoryId, [item])
      }
      derived.byCategory = map
    }
    return derived.byCategory
  }

  const store: CatalogStore = {
    getSourceRevision: revisionOf,

    beginGeneration(sourceId, type) {
      generationCounter += 1
      return { sourceId, type, revision: revisionOf(sourceId), generation: generationCounter }
    },

    isTokenCurrent(token) {
      return token.revision === revisionOf(token.sourceId)
    },

    sourceSignal(sourceId) {
      let controller = controllers.get(sourceId)
      if (!controller) {
        controller = new AbortController()
        controllers.set(sourceId, controller)
      }
      return controller.signal
    },

    commit({ token, mode, items, categories, categoryId, origin }) {
      if (token.revision !== revisionOf(token.sourceId)) return 'stale'
      const existing = getPartition(token.sourceId, token.type)
      const itemsAccepted = !!items && token.generation > (existing?.itemsGeneration ?? 0)
      const categoriesAccepted = !!categories && token.generation > (existing?.categoriesGeneration ?? 0)
      if (!itemsAccepted && !categoriesAccepted) return items || categories ? 'superseded' : 'committed'

      const partition = existing ?? ensurePartition(token.sourceId, token.type)
      const patch: Partial<CatalogStatus> = {}

      if (itemsAccepted && items) {
        if (mode === 'replace') {
          setAllItems(partition, items)
          partition.itemsGeneration = token.generation
          patch.complete = true
          patch.error = null
          patch.fromCache = origin?.fromCache ?? false
          patch.fetchedAt = origin?.fetchedAt ?? Date.now()
        } else {
          upsertItems(partition, items)
          if (categoryId) partition.loadedCategoryIds.add(categoryId)
        }
        patch.count = partition.items.length
        patch.loaded = true
      }

      if (categoriesAccepted && categories) {
        partition.categories = uniqueCategories(categories)
        partition.categoriesGeneration = token.generation
        patch.categoriesLoaded = true
      }

      updateStatus(partition, patch, true)
      emit(partition.sourceId, partition.type)
      return 'committed'
    },

    beginReplace(token) {
      const items: CatalogItem[] = []
      const idIndex = new Map<string, number>()
      let finished = false
      return {
        token,
        get count() {
          return items.length
        },
        append(batch) {
          if (finished) throw new Error('StagedReplace: append after finish')
          for (const item of batch) {
            if (idIndex.has(item.id)) continue
            idIndex.set(item.id, items.length)
            items.push(item)
          }
        },
        finish(options = {}) {
          if (finished) throw new Error('StagedReplace: finished twice')
          finished = true
          if (token.revision !== revisionOf(token.sourceId)) return 'stale'
          const existing = getPartition(token.sourceId, token.type)
          if (token.generation <= (existing?.itemsGeneration ?? 0)) return 'superseded'

          const partition = existing ?? ensurePartition(token.sourceId, token.type)
          partition.items = items
          partition.idIndex = idIndex
          partition.loadedCategoryIds = new Set()
          partition.itemsGeneration = token.generation
          const patch: Partial<CatalogStatus> = {
            complete: true,
            error: null,
            count: items.length,
            loaded: true,
            fromCache: options.origin?.fromCache ?? false,
            fetchedAt: options.origin?.fetchedAt ?? Date.now()
          }
          if (options.categories && token.generation > partition.categoriesGeneration) {
            partition.categories = uniqueCategories(options.categories)
            partition.categoriesGeneration = token.generation
            patch.categoriesLoaded = true
          }
          updateStatus(partition, patch, true)
          emit(partition.sourceId, partition.type)
          return 'committed'
        }
      }
    },

    setSyncState(token, patch) {
      if (token.revision !== revisionOf(token.sourceId)) return false
      const existing = getPartition(token.sourceId, token.type)
      // A sync that a newer complete list already overtook has nothing to report.
      if (existing && token.generation < existing.itemsGeneration) return false
      const partition = existing ?? ensurePartition(token.sourceId, token.type)
      const next: Partial<CatalogStatus> = {}
      if (patch.syncing !== undefined && patch.syncing !== partition.status.syncing) next.syncing = patch.syncing
      if (patch.error !== undefined && patch.error !== partition.status.error) next.error = patch.error
      if (Object.keys(next).length === 0 && existing) return true
      updateStatus(partition, next, false)
      emit(partition.sourceId, partition.type)
      return true
    },

    replaceSource(sourceId, replacement, expectedRevision) {
      if (expectedRevision !== undefined && expectedRevision !== revisionOf(sourceId)) return false
      invalidateSource(sourceId)

      if (!replacement) {
        for (const type of CATALOG_TYPES) {
          const partition = getPartition(sourceId, type)
          if (!partition) continue
          partition.loadedCategoryIds = new Set()
          partition.itemsGeneration = 0
          partition.categoriesGeneration = 0
          // Categories too: they are fetched again and replaced, the old list
          // stays on screen meanwhile.
          updateStatus(partition, { complete: false, categoriesLoaded: false, syncing: false, error: null }, false)
          emit(sourceId, type)
        }
        return true
      }

      const fetchedAt = Date.now()
      for (const type of CATALOG_TYPES) {
        const lists = replacement[type]
        const partition = ensurePartition(sourceId, type)
        setAllItems(partition, lists?.items ?? EMPTY_ITEMS)
        partition.categories = lists ? uniqueCategories(lists.categories) : EMPTY_CATEGORIES
        partition.itemsGeneration = 0
        partition.categoriesGeneration = 0
        const status: Partial<CatalogStatus> = {
          count: partition.items.length,
          loaded: true,
          complete: true,
          categoriesLoaded: true,
          syncing: false,
          error: null,
          fromCache: false,
          fetchedAt
        }
        updateStatus(partition, status, true)
        emit(sourceId, type)
      }
      return true
    },

    removeSource(sourceId) {
      invalidateSource(sourceId)
      for (const type of CATALOG_TYPES) {
        const key = partitionKey(sourceId, type)
        if (!partitions.delete(key)) continue
        nextVersion()
        emit(sourceId, type)
      }
    },

    reset() {
      const removed = [...partitions.values()].map((partition) => [partition.sourceId, partition.type] as const)
      for (const sourceId of new Set(removed.map(([sourceId]) => sourceId))) invalidateSource(sourceId)
      partitions.clear()
      nextVersion()
      for (const [sourceId, type] of removed) emit(sourceId, type)
    },

    getStatus(sourceId, type) {
      return getPartition(sourceId, type)?.status ?? null
    },

    getStatuses() {
      return [...partitions.values()].map((partition) => partition.status)
    },

    getSourceIds() {
      const ids = new Set<string>()
      for (const partition of partitions.values()) ids.add(partition.sourceId)
      return [...ids]
    },

    getItems(sourceId, type) {
      return getPartition(sourceId, type)?.items ?? EMPTY_ITEMS
    },

    getCategories(sourceId, type) {
      return getPartition(sourceId, type)?.categories ?? EMPTY_CATEGORIES
    },

    getItem(id) {
      for (const partition of partitions.values()) {
        const index = partition.idIndex.get(id)
        if (index !== undefined) return partition.items[index]
      }
      return undefined
    },

    getCategoryItems(sourceId, type, categoryId) {
      const partition = getPartition(sourceId, type)
      if (!partition) return EMPTY_ITEMS
      return byCategoryOf(partition).get(categoryId) ?? EMPTY_ITEMS
    },

    isCategoryLoaded(sourceId, type, categoryId) {
      const partition = getPartition(sourceId, type)
      if (!partition) return false
      return partition.status.complete || partition.loadedCategoryIds.has(categoryId)
    },

    getAdultCategoryIds(sourceId, type) {
      const partition = getPartition(sourceId, type)
      return partition ? adultCategoryIdsOf(partition) : EMPTY_IDS
    },

    getVisibleItems(sourceId, type, settings, categoryId) {
      const partition = getPartition(sourceId, type)
      if (!partition) return EMPTY_ITEMS
      const cache = viewCacheFor(partition, settings)
      const key = categoryId ?? ''
      const cached = cache.views.get(key)
      if (cached) return cached

      const source = categoryId ? (byCategoryOf(partition).get(categoryId) ?? EMPTY_ITEMS) : partition.items
      const view = applyCatalogView(source, {
        hiddenCategoryIds: settings.hiddenCategoryIds,
        adultCategoryIds: adultCategoryIdsOf(partition),
        showAdultContent: settings.showAdultContent
      })
      cache.views.set(key, view)
      return view
    },

    getVisibleCategories(sourceId, type, settings, request = {}) {
      const partition = getPartition(sourceId, type)
      if (!partition) return EMPTY_CATEGORIES
      const cache = viewCacheFor(partition, settings)
      const key = request.includeHidden ? 'all' : 'visible'
      const cached = cache.categoryViews.get(key)
      if (cached) return cached
      const view = applyCategoryView(partition.categories, {
        hiddenCategoryIds: settings.hiddenCategoryIds,
        includeHidden: request.includeHidden,
        showAdultContent: settings.showAdultContent
      })
      cache.categoryViews.set(key, view)
      return view
    },

    getVersion() {
      return version
    },

    subscribe(listener) {
      return addListener(ALL_KEY, listener)
    },

    subscribePartition(sourceId, type, listener) {
      return addListener(partitionKey(sourceId, type), listener)
    }
  }

  return store
}

/** The app's catalog. Tests that need isolation create their own with `createCatalogStore`. */
export const catalog: CatalogStore = createCatalogStore()
