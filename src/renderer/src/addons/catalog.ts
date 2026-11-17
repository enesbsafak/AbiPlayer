import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { normalizeSearchKey } from '@/catalog/normalize'
import { toCatalogSyncError } from '@/catalog/sync-error'
import type { CatalogCategory, CatalogItem, CatalogSyncError, CatalogType } from '@/catalog/types'
import { isAdultLabel } from '@/services/adult-content'
import type { AddonCatalogSummary, AddonManifestSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import { fetchAddonCatalogPage, type AddonCatalogPage, type AddonFetchOptions, type AddonMetaPreview } from './client'
import { browsableCatalogs, catalogSupportsSkip } from './manifest'

/*
 * An add-on's catalogues in the catalog store. Each film catalogue is a
 * category of the `vod` partition, each series catalogue one of `series`;
 * other types are not shown. Items arrive page by page when a category is
 * opened: no complete list, no background sync, no disk cache, no worker.
 *
 * Ids follow the converters' scheme, `<sourceId>_<type>_<provider id>`, so
 * hidden-category flags and the source-removal cleanup find them. The
 * provider id of a category is its catalogue id; that of an item is the
 * catalogue id and the meta id together. The same film listed by two
 * catalogues is therefore two records, one per category: the store keeps
 * one category per record, and a shared record would move from one category
 * to the other with every page.
 *
 * Paging uses the store's partial commits as they are. A page is upserted
 * without `categoryId` (appended in order, a repeated id updated in place),
 * so the category does not count as loaded; the page that ends the
 * catalogue is committed with `categoryId`, which marks it loaded
 * (`isCategoryLoaded`). Where paging stands (next offset, end, running,
 * error) is kept here, per category, beside the store.
 */

/** A category never holds more than this many items; paging stops there. */
export const MAX_ADDON_CATEGORY_ITEMS = 5_000

export function addonCategoryId(sourceId: string, type: CatalogType, catalogId: string): string {
  return `${sourceId}_${type}_${encodeURIComponent(catalogId)}`
}

export function addonItemId(sourceId: string, type: CatalogType, catalogId: string, metaId: string): string {
  return `${addonCategoryId(sourceId, type, catalogId)}/${encodeURIComponent(metaId)}`
}

/** The catalogues of an add-on as the categories of one partition (`vod` or `series`). */
export function addonCategoriesFor(sourceId: string, summary: AddonManifestSummary, type: CatalogType): CatalogCategory[] {
  return browsableCatalogs(summary, type).map((entry) => ({
    id: addonCategoryId(sourceId, type, entry.id),
    name: entry.name,
    sourceId,
    type,
    isAdult: summary.adult || isAdultLabel(entry.name)
  }))
}

/** The catalogue a category id of the source stands for. */
export function findAddonCatalog(
  sourceId: string,
  summary: AddonManifestSummary,
  type: CatalogType,
  categoryId: string
): AddonCatalogSummary | null {
  return browsableCatalogs(summary, type).find((entry) => addonCategoryId(sourceId, type, entry.id) === categoryId) ?? null
}

export interface AddonItemContext {
  sourceId: string
  type: CatalogType
  catalog: Pick<AddonCatalogSummary, 'id' | 'name'>
  /** The add-on marks everything it lists as adult. */
  adult: boolean
}

/** A meta preview as a catalog record. No URL: the stream is chosen among candidates when played. */
export function metaPreviewToItem(meta: AddonMetaPreview, context: AddonItemContext): CatalogItem {
  const item: CatalogItem = {
    id: addonItemId(context.sourceId, context.type, context.catalog.id, meta.id),
    name: meta.name,
    streamUrl: '',
    sourceId: context.sourceId,
    type: context.type,
    addonMetaId: meta.id,
    categoryId: addonCategoryId(context.sourceId, context.type, context.catalog.id),
    categoryName: context.catalog.name,
    searchName: normalizeSearchKey(meta.name),
    isAdult: context.adult || isAdultLabel(meta.name)
  }
  if (meta.poster) {
    item.logo = meta.poster
    item.coverUrl = meta.poster
  }
  if (meta.year) item.year = meta.year
  if (meta.rating) item.rating = meta.rating
  return item
}

/**
 * Puts an add-on's film and series catalogues into the store as categories
 * (the complete category list of each partition). Items are not touched.
 */
export function commitAddonCategories(source: PlaylistSource, store: CatalogStore = defaultCatalog): void {
  if (source.type !== 'addon' || !source.addon) return
  for (const type of ['vod', 'series'] as const) {
    store.commit({
      token: store.beginGeneration(source.id, type),
      mode: 'partial',
      categories: addonCategoriesFor(source.id, source.addon, type)
    })
  }
}

// ---------------------------------------------------------------------------
// Paging

export interface AddonCategoryPaging {
  /** Pages committed so far. */
  pages: number
  /** Entries received so far: the `skip` of the next page. */
  nextSkip: number
  /** No further page: the catalogue ended (a short or empty page, nothing new, or the item cap). */
  ended: boolean
  /** A page request is running. */
  loading: boolean
  /** The last page request failed; cleared when the next one starts. */
  error: CatalogSyncError | null
}

export interface AddonPagerDeps {
  store?: CatalogStore
  /** The source as configured now (with its base address in memory), or undefined. */
  getSource: (sourceId: string) => PlaylistSource | undefined
  fetchPage?: (
    base: string,
    catalog: AddonCatalogSummary,
    skip: number,
    options: AddonFetchOptions
  ) => Promise<AddonCatalogPage>
}

interface PagingState extends AddonCategoryPaging {
  /** Store revision of the source when paging started; another revision starts over. */
  revision: number
  /** Size of the first page: a later page shorter than it is the last. */
  pageSize: number
  controller: AbortController | null
}

export interface AddonCatalogPager {
  /**
   * Loads the first page of a category unless it has one (or is loading it).
   * Resolves when the request settled; never rejects (failures land in the
   * paging state's `error`).
   */
  loadFirstPage(sourceId: string, type: CatalogType, categoryId: string): Promise<void>
  /** Loads the next page unless the category ended, is loading, or has no first page yet. */
  loadNextPage(sourceId: string, type: CatalogType, categoryId: string): Promise<void>
  /** Runs the failed request again: the first page if none came, else the next one. */
  retry(sourceId: string, type: CatalogType, categoryId: string): Promise<void>
  getPaging(sourceId: string, type: CatalogType, categoryId: string): AddonCategoryPaging | null
  /** Called on every change of any paging state. */
  subscribe(listener: () => void): () => void
  /** Forgets a source's paging (its requests are cancelled), or every source's. */
  reset(sourceId?: string): void
  /** Clears the errors of a source's categories, so the pages can ask again (after a certificate was trusted, say). */
  clearErrors(sourceId: string): void
}

function pagingKey(sourceId: string, type: CatalogType, categoryId: string): string {
  return `${sourceId}\n${type}\n${categoryId}`
}

function publicPaging(state: PagingState): AddonCategoryPaging {
  return { pages: state.pages, nextSkip: state.nextSkip, ended: state.ended, loading: state.loading, error: state.error }
}

export function createAddonCatalogPager(deps: AddonPagerDeps): AddonCatalogPager {
  const store = deps.store ?? defaultCatalog
  const fetchPage = deps.fetchPage ?? fetchAddonCatalogPage
  const states = new Map<string, PagingState>()
  const snapshots = new Map<string, AddonCategoryPaging>()
  const listeners = new Set<() => void>()

  const notify = (key: string) => {
    const state = states.get(key)
    if (state) snapshots.set(key, publicPaging(state))
    else snapshots.delete(key)
    for (const listener of [...listeners]) listener()
  }

  /** The state of a category, dropped when the source was refreshed or removed since. */
  const current = (sourceId: string, key: string): PagingState | null => {
    const state = states.get(key)
    if (!state) return null
    if (state.revision === store.getSourceRevision(sourceId)) return state
    state.controller?.abort()
    states.delete(key)
    snapshots.delete(key)
    return null
  }

  const settle = (key: string, state: PagingState, error: CatalogSyncError | null) => {
    state.loading = false
    state.controller = null
    state.error = error
    notify(key)
  }

  const load = async (sourceId: string, type: CatalogType, categoryId: string, first: boolean): Promise<void> => {
    const key = pagingKey(sourceId, type, categoryId)
    const existing = current(sourceId, key)
    if (existing?.loading) return
    if (first ? !!existing && existing.pages > 0 : !existing || existing.pages === 0 || existing.ended) return

    const source = deps.getSource(sourceId)
    const summary = source?.type === 'addon' ? source.addon : undefined
    const entry = summary ? findAddonCatalog(sourceId, summary, type, categoryId) : null
    const base = source?.url
    // Not an add-on catalogue of this source (any more), or its address is
    // not loaded yet: there is nothing to ask.
    if (!summary || !entry || !base) return

    const state: PagingState = existing ?? {
      pages: 0,
      nextSkip: 0,
      ended: false,
      loading: false,
      error: null,
      revision: store.getSourceRevision(sourceId),
      pageSize: 0,
      controller: null
    }
    states.set(key, state)

    const controller = new AbortController()
    const sourceSignal = store.sourceSignal(sourceId)
    const onSourceAbort = () => controller.abort()
    sourceSignal.addEventListener('abort', onSourceAbort, { once: true })
    state.loading = true
    state.error = null
    state.controller = controller
    notify(key)

    const token = store.beginGeneration(sourceId, type)
    const skip = state.nextSkip
    try {
      const page = await fetchPage(base, entry, skip, { signal: controller.signal })
      if (states.get(key) !== state) return
      if (controller.signal.aborted) {
        // The source was removed or refreshed while the page was on its way.
        states.delete(key)
        notify(key)
        return
      }
      const context: AddonItemContext = { sourceId, type, catalog: entry, adult: summary.adult }
      // Every entry of a film catalogue is a film to the app, whatever type it names.
      const items = page.metas.map((meta) => metaPreviewToItem(meta, context))
      const fresh = items.filter((item) => store.getItem(item.id) === undefined).length
      const total = store.getCategoryItems(sourceId, type, categoryId).length + fresh
      if (state.pages === 0) state.pageSize = page.received
      const ended =
        page.received === 0 ||
        page.received < state.pageSize ||
        (state.pages > 0 && fresh === 0) ||
        total >= MAX_ADDON_CATEGORY_ITEMS ||
        !catalogSupportsSkip(entry)
      const kept = total > MAX_ADDON_CATEGORY_ITEMS ? items.slice(0, Math.max(0, items.length - (total - MAX_ADDON_CATEGORY_ITEMS))) : items
      const result = store.commit({ token, mode: 'partial', items: kept, ...(ended ? { categoryId } : {}) })
      if (result === 'stale') {
        // The source was refreshed or removed meanwhile: this paging is over.
        states.delete(key)
        notify(key)
        return
      }
      state.pages += 1
      state.nextSkip = skip + page.received
      state.ended = ended
      settle(key, state, null)
    } catch (error) {
      if (states.get(key) !== state) return
      // A cancelled request is not an error (`toCatalogSyncError` gives null).
      const failure = toCatalogSyncError(await certificateAwareError(error))
      if (states.get(key) === state) settle(key, state, failure)
    } finally {
      sourceSignal.removeEventListener('abort', onSourceAbort)
    }
  }

  return {
    loadFirstPage: (sourceId, type, categoryId) => load(sourceId, type, categoryId, true),
    loadNextPage: (sourceId, type, categoryId) => load(sourceId, type, categoryId, false),
    retry(sourceId, type, categoryId) {
      const state = current(sourceId, pagingKey(sourceId, type, categoryId))
      return load(sourceId, type, categoryId, !state || state.pages === 0)
    },
    getPaging(sourceId, type, categoryId) {
      const key = pagingKey(sourceId, type, categoryId)
      return current(sourceId, key) ? (snapshots.get(key) ?? null) : null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset(sourceId) {
      for (const [key, state] of [...states]) {
        if (sourceId !== undefined && !key.startsWith(`${sourceId}\n`)) continue
        state.controller?.abort()
        states.delete(key)
        notify(key)
      }
    },
    clearErrors(sourceId) {
      for (const [key, state] of states) {
        if (!key.startsWith(`${sourceId}\n`) || !state.error) continue
        state.error = null
        notify(key)
      }
    }
  }
}
