import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { toCatalogSyncError } from '@/catalog/sync-error'
import type { CatalogItem, CatalogSyncError, CatalogType } from '@/catalog/types'
import type { AddonCatalogSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import { metaPreviewToItem } from './catalog'
import type { AddonCatalogPage } from './client'
import { catalogSupportsSkip } from './manifest'
import type { AddonCatalogProvider } from './provider'

/*
 * The search box of Filmler and Diziler while the source in use can search
 * (the built-in TMDB catalogue, or an add-on whose catalogue declares the
 * `search` extra): the query goes to the source, page by page, instead of
 * filtering what is loaded. Typing waits a moment before asking; a new query
 * cancels the request of the previous one. Results live in memory only, in
 * this state, not in the catalog store: they are no category.
 */

/** How long typing must pause before the source is asked. */
export const ADDON_SEARCH_DEBOUNCE_MS = 350
/** Results kept at most; paging stops there. */
export const MAX_ADDON_SEARCH_RESULTS = 1_000

export interface AddonSearchState {
  /** The query the results are for (trimmed); empty: no search. */
  query: string
  items: CatalogItem[]
  /** Every match, when the source says (TMDB's `total_results`). */
  total: number | null
  pages: number
  /** The `skip` of the next page. */
  nextSkip: number
  ended: boolean
  loading: boolean
  /** The last page request failed; cleared when the next one starts. */
  error: CatalogSyncError | null
}

export const EMPTY_ADDON_SEARCH: AddonSearchState = {
  query: '',
  items: [],
  total: null,
  pages: 0,
  nextSkip: 0,
  ended: false,
  loading: false,
  error: null
}

export type AddonSearchAction =
  /** A page is asked for `query`; another query starts over. */
  | { type: 'loading'; query: string }
  | { type: 'page'; query: string; skip: number; items: CatalogItem[]; page: AddonCatalogPage; pageable: boolean }
  | { type: 'failed'; query: string; error: CatalogSyncError }
  | { type: 'clear' }

export function addonSearchReducer(state: AddonSearchState, action: AddonSearchAction): AddonSearchState {
  switch (action.type) {
    case 'loading':
      return action.query === state.query
        ? { ...state, loading: true, error: null }
        : { ...EMPTY_ADDON_SEARCH, query: action.query, loading: true }
    case 'page': {
      // An answer for another query, or for a page already in: not this one's.
      if (action.query !== state.query || action.skip !== state.nextSkip) return state
      const known = new Set(state.items.map((item) => item.id))
      const fresh = action.items.filter((item) => !known.has(item.id))
      const items = [...state.items, ...fresh].slice(0, MAX_ADDON_SEARCH_RESULTS)
      const ended =
        action.page.ended === true ||
        action.page.received === 0 ||
        !action.pageable ||
        (state.pages > 0 && fresh.length === 0) ||
        items.length >= MAX_ADDON_SEARCH_RESULTS
      return {
        ...state,
        items,
        total: action.page.total ?? state.total,
        pages: state.pages + 1,
        nextSkip: state.nextSkip + action.page.received,
        ended,
        loading: false,
        error: null
      }
    }
    case 'failed':
      return action.query === state.query ? { ...state, loading: false, error: action.error } : state
    case 'clear':
      return EMPTY_ADDON_SEARCH
    default:
      return state
  }
}

/** What a search is asked of: the source in use and its search catalogue of the page's type. */
export interface AddonSearchTarget {
  source: PlaylistSource
  type: CatalogType
  catalog: AddonCatalogSummary
}

/** One page of results as catalog records; rejects like the provider. */
export async function fetchAddonSearchPage(
  provider: AddonCatalogProvider,
  target: AddonSearchTarget,
  query: string,
  skip: number,
  signal?: AbortSignal
): Promise<{ page: AddonCatalogPage; items: CatalogItem[] }> {
  const page = await provider.catalogPage(target.catalog, { skip, search: query }, { signal })
  const context = {
    sourceId: target.source.id,
    type: target.type,
    catalog: target.catalog,
    adult: target.source.addon?.adult === true
  }
  return { page, items: page.metas.map((meta) => metaPreviewToItem(meta, context)) }
}

export interface AddonSearchModel {
  /** The source is being searched for a query (the grid shows its results). */
  active: boolean
  /** The query typed has not been asked yet (typing, or the pause after it). */
  pending: boolean
  state: AddonSearchState
  loadMore: () => void
  retry: () => void
}

/**
 * Searches `target` for `rawQuery` once typing pauses; null `target` (the
 * source cannot search this type) turns it off. `getProvider` gives the
 * source's provider now (it needs the address or the TMDB key in memory).
 */
export function useAddonSearch(
  target: AddonSearchTarget | null,
  rawQuery: string,
  getProvider: (source: PlaylistSource) => AddonCatalogProvider | null,
  debounceMs = ADDON_SEARCH_DEBOUNCE_MS
): AddonSearchModel {
  const query = target ? rawQuery.trim() : ''
  const [applied, setApplied] = useState(query)
  const [state, dispatch] = useReducer(addonSearchReducer, EMPTY_ADDON_SEARCH)
  const controllerRef = useRef<AbortController | null>(null)
  const targetRef = useRef(target)
  const getProviderRef = useRef(getProvider)
  const stateRef = useRef(state)
  useEffect(() => {
    targetRef.current = target
    getProviderRef.current = getProvider
    stateRef.current = state
  })

  // Clearing the box is at once; a query waits for typing to pause.
  useEffect(() => {
    if (!query) {
      setApplied('')
      return
    }
    const timer = setTimeout(() => setApplied(query), debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs])

  const run = useCallback((searchQuery: string, skip: number) => {
    const current = targetRef.current
    const provider = current ? getProviderRef.current(current.source) : null
    if (!current || !provider) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'loading', query: searchQuery })
    void fetchAddonSearchPage(provider, current, searchQuery, skip, controller.signal).then(
      ({ page, items }) => {
        if (controller.signal.aborted) return
        dispatch({ type: 'page', query: searchQuery, skip, items, page, pageable: catalogSupportsSkip(current.catalog) })
      },
      async (error: unknown) => {
        if (controller.signal.aborted) return
        // A cancel is no failure (`toCatalogSyncError` gives null).
        const failure = toCatalogSyncError(await certificateAwareError(error))
        if (failure && !controller.signal.aborted) dispatch({ type: 'failed', query: searchQuery, error: failure })
      }
    )
  }, [])

  const sourceId = target?.source.id ?? null
  const type = target?.type ?? null
  const catalogId = target?.catalog.id ?? null
  useEffect(() => {
    controllerRef.current?.abort()
    if (!applied || !sourceId) {
      dispatch({ type: 'clear' })
      return
    }
    run(applied, 0)
    return () => controllerRef.current?.abort()
  }, [applied, sourceId, type, catalogId, run])

  const loadMore = useCallback(() => {
    const current = stateRef.current
    if (!current.query || current.loading || current.ended || current.error || current.pages === 0) return
    run(current.query, current.nextSkip)
  }, [run])

  const retry = useCallback(() => {
    const current = stateRef.current
    if (!current.query || current.loading) return
    run(current.query, current.pages === 0 ? 0 : current.nextSkip)
  }, [run])

  return useMemo(
    () => ({ active: !!target && !!query, pending: query !== applied, state, loadMore, retry }),
    [target, query, applied, state, loadMore, retry]
  )
}
