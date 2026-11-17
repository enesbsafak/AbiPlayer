import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { selectedCategoryFor } from '@/store/playlist-slice'
import { xtreamApi } from '@/services/xtream-api'
import { openPlayerFromRoute } from '@/services/player-navigation'
import { ensureFullSync, ensureStagedSync } from '@/services/background-sync'
import { buildCatalogRetainResetKey } from '@/services/catalog-view'
import { toUserMessage } from '@/services/user-error'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { useRetainedListWhileLoading } from '@/hooks/useRetainedListWhileLoading'
import type { VirtualCardGridHandle } from '@/components/catalog/VirtualCardGrid'
import { addonCatalogPager, appCatalogProvider, useAddonCategoryPaging, useCatalogSourceReady } from '@/addons/pager'
import { addonErrorMessage } from '@/addons/messages'
import { isTmdbCatalogSource } from '@/addons/builtin'
import { searchCatalogFor } from '@/addons/manifest'
import { useAddonSearch, type AddonSearchTarget } from '@/addons/search'
import {
  catalog,
  filterBySearch,
  useCatalogCategories,
  useCatalogStatus,
  useCatalogViewSettings,
  useVisibleCatalogCategories,
  useVisibleCatalogItems,
  xtreamCategoriesToRecords,
  xtreamLiveToRecords,
  xtreamSeriesToRecords,
  xtreamVodToRecords,
  type CatalogItem,
  type CatalogType
} from '@/catalog'
import type { XtreamCategory, XtreamCredentials } from '@/types/xtream'
import {
  addonPagerView,
  buildCatalogRouteState,
  catalogBanner,
  effectiveAddonCategoryId,
  parseCatalogRouteState,
  providerCategoryId,
  type CatalogBanner,
  type CatalogDetailRef,
  type CatalogRouteState
} from './catalog-page-state'
import { strings } from '@/strings'

type Signal = { signal: AbortSignal }

/** The Xtream calls a catalog page makes, per content type. */
const XTREAM_LOADERS: Record<
  CatalogType,
  {
    categories: (creds: XtreamCredentials, options: Signal) => Promise<XtreamCategory[]>
    category: (creds: XtreamCredentials, categoryId: string, sourceId: string, options: Signal) => Promise<CatalogItem[]>
    preview: (creds: XtreamCredentials, sourceId: string, options: Signal) => Promise<CatalogItem[]>
  }
> = {
  live: {
    categories: (creds, options) => xtreamApi.getLiveCategories(creds, options),
    category: async (creds, id, sourceId, options) => xtreamLiveToRecords(await xtreamApi.getLiveStreams(creds, id, options), sourceId),
    preview: async (creds, sourceId, options) => xtreamLiveToRecords(await xtreamApi.getLivePreviewStreams(creds, PREVIEW_SIZE, options), sourceId)
  },
  vod: {
    categories: (creds, options) => xtreamApi.getVodCategories(creds, options),
    category: async (creds, id, sourceId, options) => xtreamVodToRecords(await xtreamApi.getVodStreams(creds, id, options), sourceId),
    preview: async (creds, sourceId, options) => xtreamVodToRecords(await xtreamApi.getVodPreviewStreams(creds, PREVIEW_SIZE, options), sourceId)
  },
  series: {
    categories: (creds, options) => xtreamApi.getSeriesCategories(creds, options),
    category: async (creds, id, sourceId, options) => xtreamSeriesToRecords(await xtreamApi.getSeries(creds, id, options), sourceId),
    preview: async (creds, sourceId, options) => xtreamSeriesToRecords(await xtreamApi.getSeriesPreviewStreams(creds, PREVIEW_SIZE, options), sourceId)
  }
}

const PREVIEW_SIZE = 500

export interface CatalogPageMessages {
  /** Shown while the quick preview list loads. */
  previewLoading: string
  /** Fallback when a load fails without a usable message. */
  loadFailed: string
}

interface ForegroundLoad {
  error: string | null
  /** What the failed load was for (source and category): the error belongs to it alone. */
  errorScope: string | null
  message: string | null
  active: boolean
}

type ForegroundAction =
  | { type: 'start'; message: string }
  | { type: 'end' }
  | { type: 'failed'; message: string; scope: string }
  | { type: 'reset' }

const IDLE: ForegroundLoad = { error: null, errorScope: null, message: null, active: false }

/** What a foreground load is for: the error of another selection is not shown. */
function selectionScope(sourceId: string | null, categoryId: string | null): string {
  return `${sourceId ?? ''}\n${categoryId ?? ''}`
}

function foregroundReducer(state: ForegroundLoad, action: ForegroundAction): ForegroundLoad {
  switch (action.type) {
    case 'start':
      return { error: null, errorScope: null, message: action.message, active: true }
    case 'end':
      return state.active ? { ...state, message: null, active: false } : state
    case 'failed':
      return { ...state, error: action.message, errorScope: action.scope }
    case 'reset':
      return IDLE
    default:
      return state
  }
}

/** Paging of an add-on category: the pages after the first, loaded as the grid nears its end. */
export interface CatalogPagerModel {
  /** A page after the first is on its way. */
  loadingMore: boolean
  /** The catalogue has no further page. */
  ended: boolean
  /** A page after the first failed: a message for the screen. */
  error: string | null
  /** Whether nearing the end of the grid may ask for the next page now. */
  canLoadMore: boolean
  loadMore: () => void
  retry: () => void
}

export interface CatalogPageModel {
  type: CatalogType
  sourceId: string | null
  isXtream: boolean
  /** The active source is an add-on: its catalogues are the categories, loaded page by page. */
  isAddon: boolean
  /** An add-on without any catalogue of this type (its categories are in and there is none). */
  noCategories: boolean
  /** Add-on paging below the grid; null for other sources. */
  pager: CatalogPagerModel | null

  selectedCategoryId: string | null
  selectCategory: (categoryId: string | null) => void
  categoriesError: string | null
  categoriesLoading: boolean
  retryCategories: () => void

  searchQuery: string
  setSearchQuery: (query: string) => void
  /** The list still shows the previous query's results. */
  isSearchPending: boolean
  /**
   * The box asks the source (the built-in TMDB catalogue, or an add-on whose
   * catalogue searches) instead of filtering what is loaded: the grid shows
   * its results, paged like a category.
   */
  searchesRemotely: boolean
  /** Shown in place of the result count while the source is being asked, or null. */
  searchStatus: string | null
  /** The source's data comes from TMDB: the page shows its credit. */
  attribution: 'tmdb' | null
  /** What the grid shows: the selected category, filtered by the (deferred) query. */
  items: readonly CatalogItem[]
  /** Every match of the query, not capped. */
  matchCount: number
  /** Items of the category in memory before the query (an add-on's pages so far). */
  loadedCount: number
  /** The query the shown items were filtered with. */
  appliedQuery: string

  /** A foreground load (preview or the selected category) is running. */
  loading: boolean
  loadingMessage: string | null
  banner: CatalogBanner | null
  /** The banner's action: reload what failed, or run the failed full sync again. */
  retry: () => void

  detail: CatalogDetailRef | null
  openDetail: (detail: CatalogDetailRef) => void
  closeDetail: () => void
  updateDetail: (patch: Partial<CatalogDetailRef>) => void

  /** The grid's scroll element and handle; the layout attaches them. */
  scrollRef: MutableRefObject<HTMLElement | null>
  gridRef: MutableRefObject<VirtualCardGridHandle | null>
  /** Restore work the layout applies once the grid has items: scroll first, then focus. */
  pendingScrollRef: MutableRefObject<number | null>
  pendingFocusRef: MutableRefObject<string | null>

  /** Route state for the player to hand back, focusing `focusItemId` on return. */
  routeStateFor: (focusItemId: string | null, detailPatch?: Partial<CatalogDetailRef>) => CatalogRouteState
  /**
   * Opens the player for what was just started, remembering this page: the
   * query, the scroll position, the card to focus and the open detail (with
   * `detailPatch`, e.g. the season of the episode started).
   */
  openPlayer: (focusItemId: string | null, detailPatch?: Partial<CatalogDetailRef>) => void
}

/**
 * Everything a catalog page (Live TV, Films, Series) does apart from how its
 * cards and details look: the category list and the selected category's
 * items (per content type and source, F1-20), the quick preview and the
 * background full sync, the status banner, deferred search with a true match
 * count, the detail view above a still-mounted grid, and what the player
 * hands back on return.
 */
export function useCatalogPage(type: CatalogType, messages: CatalogPageMessages): CatalogPageModel {
  const location = useLocation()
  const navigate = useNavigate()
  const sourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const sourceError = useStore((s) => (s.activeSourceId ? (s.sourceErrors[s.activeSourceId] ?? null) : null))
  const requestSourceReconnect = useStore((s) => s.requestSourceReconnect)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)
  const storedCategoryId = useStore((s) => selectedCategoryFor(s.selectedCategoryIds, s.activeSourceId, type))
  const status = useCatalogStatus(sourceId, type)
  const isComplete = status?.complete === true
  const categoriesLoaded = status?.categoriesLoaded === true

  const [searchQuery, setSearchQuery] = useState('')
  const [detail, setDetail] = useState<CatalogDetailRef | null>(null)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [categoriesReload, bumpCategoriesReload] = useReducer((value: number) => value + 1, 0)
  const [reloadToken, bumpReload] = useReducer((value: number) => value + 1, 0)
  const [foreground, dispatch] = useReducer(foregroundReducer, IDLE)
  const scrollRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<VirtualCardGridHandle | null>(null)
  const pendingScrollRef = useRef<number | null>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const previousSourceIdRef = useRef(sourceId)

  const source = useMemo(() => sources.find((item) => item.id === sourceId) ?? null, [sources, sourceId])
  const isXtream = source?.type === 'xtream'
  const isAddon = source?.type === 'addon'
  const isTmdbCatalog = isTmdbCatalogSource(source)
  // An add-on asks once its address is in memory, the TMDB catalogue while a key is saved.
  const catalogReady = useCatalogSourceReady(isAddon ? sourceId : null)
  const addonAddressLoaded = isAddon && catalogReady
  // Without its secret an Xtream source loads nothing: its page says so
  // instead of waiting for a preview and a category list that never come.
  // An add-on without its address cannot ask for a page either, nor the
  // TMDB catalogue without a key.
  const missingSecret =
    credentialsHydrated &&
    !!sourceId &&
    ((isXtream && !getXtreamCredentials(sourceId)) || (isAddon && !addonAddressLoaded))
  // An add-on has no "all": its first visible catalogue stands in for none
  // (or for a selection that is hidden now).
  const visibleCategories = useVisibleCatalogCategories(isAddon ? sourceId : null, type)
  // Hidden ones (by the viewer, or adult with that setting off) still exist.
  const addonCategoryCount = useCatalogCategories(isAddon ? sourceId : null, type).length
  const selectedCategoryId = isAddon ? effectiveAddonCategoryId(storedCategoryId, visibleCategories) : storedCategoryId
  const rawCategoryId = providerCategoryId(sourceId, type, selectedCategoryId)
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  })

  const selectCategory = useCallback(
    (categoryId: string | null) => {
      if (sourceId) setSelectedCategory(sourceId, type, categoryId)
    },
    [setSelectedCategory, sourceId, type]
  )

  // Returning from the player, or opened from another screen with a target.
  useEffect(() => {
    const restore = parseCatalogRouteState(location.state, type)
    if (!restore) return
    if (restore.searchQuery !== undefined) setSearchQuery(restore.searchQuery)
    if (restore.detail) setDetail(restore.detail)
    pendingScrollRef.current = restore.scrollTop ?? null
    pendingFocusRef.current = restore.focusItemId ?? restore.detail?.itemId ?? null
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null }
    )
  }, [location.hash, location.pathname, location.search, location.state, navigate, type])

  // Another source: its own selection is kept per source; the query and an
  // open detail belong to the previous one.
  useEffect(() => {
    const previous = previousSourceIdRef.current
    previousSourceIdRef.current = sourceId
    if (previous === sourceId) return
    setSearchQuery('')
    setDetail(null)
    setCategoriesError(null)
    dispatch({ type: 'reset' })
  }, [sourceId])

  // The category list.
  useEffect(() => {
    if (!sourceId || !source || source.type !== 'xtream' || categoriesLoaded) return
    const creds = getXtreamCredentials(sourceId)
    if (!creds) return
    const controller = new AbortController()
    const token = catalog.beginGeneration(sourceId, type)
    setCategoriesError(null)
    void XTREAM_LOADERS[type]
      .categories(creds, { signal: controller.signal })
      .then((categories) => {
        if (controller.signal.aborted) return
        catalog.commit({ token, mode: 'partial', categories: xtreamCategoriesToRecords(categories, sourceId, type) })
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        console.error(`Failed to load ${type} categories:`, error)
        const message = toUserMessage(await certificateAwareError(error), strings.catalog.page.categoryListFailed)
        if (!controller.signal.aborted) setCategoriesError(message)
      })
    return () => controller.abort()
  }, [sourceId, source, type, categoriesLoaded, getXtreamCredentials, categoriesReload])

  // The selected category, fetched on its own unless it is already in memory.
  useEffect(() => {
    if (!sourceId || !rawCategoryId || !selectedCategoryId || !source || source.type !== 'xtream') return
    const creds = getXtreamCredentials(sourceId)
    if (!creds) return
    if (catalog.isCategoryLoaded(sourceId, type, selectedCategoryId)) return

    const controller = new AbortController()
    const token = catalog.beginGeneration(sourceId, type)
    const scope = selectionScope(sourceId, selectedCategoryId)
    dispatch({ type: 'start', message: strings.catalog.page.categoryLoading })
    void XTREAM_LOADERS[type]
      .category(creds, rawCategoryId, sourceId, { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return
        catalog.commit({ token, mode: 'partial', items, categoryId: selectedCategoryId })
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        console.error(`Failed to load ${type} category:`, error)
        const message = toUserMessage(await certificateAwareError(error), messagesRef.current.loadFailed)
        if (!controller.signal.aborted) dispatch({ type: 'failed', message, scope })
      })
      .finally(() => {
        if (!controller.signal.aborted) dispatch({ type: 'end' })
      })
    return () => {
      controller.abort()
      // Ended here, before a following run can start a load of its own.
      dispatch({ type: 'end' })
    }
  }, [sourceId, source, type, rawCategoryId, selectedCategoryId, getXtreamCredentials, reloadToken])

  // "All": a quick preview when nothing is in memory, then the full list in
  // the background. A failed full sync is not retried by itself on every
  // visit; the banner offers the retry.
  useEffect(() => {
    if (!sourceId || rawCategoryId || !source || source.type !== 'xtream') return
    const creds = getXtreamCredentials(sourceId)
    if (!creds) return
    const controller = new AbortController()

    const startSync = () => {
      const current = catalog.getStatus(sourceId, type)
      if (current?.complete || current?.syncing || current?.error) return
      void ensureStagedSync(sourceId, type, creds)
    }

    if (catalog.getStatus(sourceId, type)?.complete) return
    if (catalog.getStatus(sourceId, type)?.loaded) {
      startSync()
      return
    }

    const token = catalog.beginGeneration(sourceId, type)
    const scope = selectionScope(sourceId, null)
    dispatch({ type: 'start', message: messagesRef.current.previewLoading })
    void XTREAM_LOADERS[type]
      .preview(creds, sourceId, { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return
        catalog.commit({ token, mode: 'partial', items })
        startSync()
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        console.error(`Failed to load ${type} preview:`, error)
        const message = toUserMessage(await certificateAwareError(error), messagesRef.current.loadFailed)
        if (!controller.signal.aborted) dispatch({ type: 'failed', message, scope })
      })
      .finally(() => {
        if (!controller.signal.aborted) dispatch({ type: 'end' })
      })
    return () => {
      controller.abort()
      dispatch({ type: 'end' })
    }
  }, [sourceId, source, type, rawCategoryId, isComplete, getXtreamCredentials, reloadToken])

  // An add-on category: its first page when it is opened. The pages after
  // it come as the grid nears its end (`pager.loadMore`). A failed first
  // page waits for the banner's retry.
  const paging = useAddonCategoryPaging(isAddon ? sourceId : null, type, selectedCategoryId)
  // Nothing asked yet, or forgotten (the source was refreshed, an error cleared).
  const needsFirstPage = paging === null || (paging.pages === 0 && !paging.loading && !paging.error)
  useEffect(() => {
    if (!isAddon || !addonAddressLoaded || !sourceId || !selectedCategoryId || !needsFirstPage) return
    void addonCatalogPager.loadFirstPage(sourceId, type, selectedCategoryId)
  }, [isAddon, addonAddressLoaded, sourceId, type, selectedCategoryId, needsFirstPage])

  const visibleItems = useVisibleCatalogItems(sourceId, type, selectedCategoryId)
  // Typing updates the box at once; the filter over a large list follows as
  // a deferred render that the next keystroke can interrupt.
  const deferredQuery = useDeferredValue(searchQuery)

  // A source that can search (the TMDB catalogue, an add-on with a search
  // catalogue of this type) is asked instead: its results replace the grid.
  const searchCatalog = isAddon && addonAddressLoaded && source?.addon ? searchCatalogFor(source.addon, type) : null
  const searchTarget = useMemo<AddonSearchTarget | null>(
    () => (source && searchCatalog ? { source, type, catalog: searchCatalog } : null),
    [source, type, searchCatalog]
  )
  const search = useAddonSearch(searchTarget, searchQuery, appCatalogProvider)
  const { state: searchState, loadMore: loadMoreResults, retry: retrySearch } = search
  const searchesRemotely = search.active
  const { showAdultContent } = useCatalogViewSettings()
  const searchItems = useMemo(
    () => (showAdultContent ? searchState.items : searchState.items.filter((item) => !item.isAdult)),
    [searchState.items, showAdultContent]
  )
  const searchFirstPageLoading = searchesRemotely && searchState.loading && searchState.pages === 0
  const searchFirstPageError = searchesRemotely && searchState.pages === 0 && !searchState.loading ? searchState.error : null

  const appliedQuery = searchesRemotely ? searchQuery : deferredQuery
  const filtered = useMemo(() => filterBySearch(visibleItems, deferredQuery), [visibleItems, deferredQuery])
  // Per query too: a query that matches nothing must not show the previous,
  // unfiltered cards next to "0 sonuç" while a load runs.
  const retainKey = `${buildCatalogRetainResetKey(sourceId, selectedCategoryId)}\n${deferredQuery}`
  const retained = useRetainedListWhileLoading(filtered, foreground.active, retainKey)
  const items = searchesRemotely ? searchItems : retained
  const addonView = addonPagerView({
    isAddon,
    addressLoaded: addonAddressLoaded,
    categoriesLoaded,
    hasCategory: !!selectedCategoryId,
    paging,
    searching: deferredQuery.trim().length > 0,
    sourceFailed: missingSecret || !!sourceError
  })

  // Read on every render; `status` changes with every commit to this slice.
  const categoryLoaded = !!sourceId && !!selectedCategoryId && catalog.isCategoryLoaded(sourceId, type, selectedCategoryId)
  const banner = catalogBanner({
    isXtream,
    hasCategory: !!selectedCategoryId,
    categoryLoaded,
    status,
    // An error of another category (or of "all") does not belong here.
    loadError: searchFirstPageError
      ? addonErrorMessage(searchFirstPageError, messages.loadFailed)
      : isAddon
        ? addonView.firstPageError && addonErrorMessage(addonView.firstPageError, messages.loadFailed)
        : foreground.errorScope === selectionScope(sourceId, selectedCategoryId)
          ? foreground.error
          : null,
    sourceError: missingSecret
      ? isTmdbCatalog
        ? strings.errors.tmdb.noKey
        : (sourceError?.message ?? strings.sources.connect.secretsLoadFailed)
      : null,
    ...(missingSecret && isTmdbCatalog ? { sourceErrorTab: 'general' as const } : {}),
    connectionFailed: !!sourceError
  })

  const retry = useCallback(() => {
    if (isAddon) {
      if (banner?.kind === 'source-error') requestSourceReconnect()
      else if (searchFirstPageError) retrySearch()
      else if (sourceId && selectedCategoryId) void addonCatalogPager.retry(sourceId, type, selectedCategoryId)
      return
    }
    if (banner?.kind === 'sync-error' || banner?.kind === 'offline') {
      // An offline copy of a source that did not connect: connect it again.
      if (banner.kind === 'offline' && sourceError) requestSourceReconnect()
      const creds = sourceId ? getXtreamCredentials(sourceId) : null
      if (sourceId && creds) void ensureFullSync(sourceId, type, creds)
      return
    }
    dispatch({ type: 'reset' })
    bumpReload()
  }, [
    banner?.kind,
    getXtreamCredentials,
    isAddon,
    requestSourceReconnect,
    retrySearch,
    searchFirstPageError,
    selectedCategoryId,
    sourceError,
    sourceId,
    type
  ])

  const loadMore = useCallback(() => {
    if (sourceId && selectedCategoryId) void addonCatalogPager.loadNextPage(sourceId, type, selectedCategoryId)
  }, [sourceId, selectedCategoryId, type])
  const retryPage = useCallback(() => {
    if (sourceId && selectedCategoryId) void addonCatalogPager.retry(sourceId, type, selectedCategoryId)
  }, [sourceId, selectedCategoryId, type])
  const pagerError = addonView.laterPageError
  const categoryPager = useMemo<CatalogPagerModel | null>(
    () =>
      isAddon && addonView.started
        ? {
            loadingMore: addonView.loadingMore,
            ended: addonView.ended,
            error: pagerError ? addonErrorMessage(pagerError, strings.catalog.addon.pageFailed) : null,
            canLoadMore: addonView.canLoadMore,
            loadMore,
            retry: retryPage
          }
        : null,
    [isAddon, addonView.started, addonView.loadingMore, addonView.ended, addonView.canLoadMore, pagerError, loadMore, retryPage]
  )
  // The results of a search the source answers page through the same footer.
  const searchPager = useMemo<CatalogPagerModel | null>(() => {
    if (!searchesRemotely || searchState.pages === 0) return null
    const laterError = searchState.loading ? null : searchState.error
    return {
      loadingMore: searchState.loading,
      ended: searchState.ended,
      error: laterError ? addonErrorMessage(laterError, strings.catalog.addon.pageFailed) : null,
      canLoadMore: !searchState.ended && !searchState.loading && !searchState.error,
      loadMore: loadMoreResults,
      retry: retrySearch
    }
  }, [searchesRemotely, searchState, loadMoreResults, retrySearch])
  const pager = searchesRemotely ? searchPager : categoryPager

  const retryCategories = useCallback(() => {
    setCategoriesError(null)
    bumpCategoriesReload()
  }, [])

  const openDetail = useCallback((next: CatalogDetailRef) => setDetail(next), [])
  const closeDetail = useCallback(() => {
    // Back on the grid, the card that opened the detail gets the focus again.
    if (detail) pendingFocusRef.current = detail.itemId
    setDetail(null)
  }, [detail])
  const updateDetail = useCallback(
    (patch: Partial<CatalogDetailRef>) => setDetail((current) => (current ? { ...current, ...patch } : current)),
    []
  )

  const routeStateFor = useCallback(
    (focusItemId: string | null, detailPatch?: Partial<CatalogDetailRef>) =>
      buildCatalogRouteState({
        searchQuery,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
        focusItemId,
        detail: detail ? { ...detail, ...detailPatch } : null
      }),
    [searchQuery, detail]
  )

  const openPlayer = useCallback(
    (focusItemId: string | null, detailPatch?: Partial<CatalogDetailRef>) => {
      setMiniPlayer(false)
      openPlayerFromRoute({
        location,
        navigate,
        returnState: routeStateFor(focusItemId, detailPatch),
        setPlayerReturnTarget
      })
    },
    [location, navigate, routeStateFor, setMiniPlayer, setPlayerReturnTarget]
  )

  return {
    type,
    sourceId,
    isXtream,
    isAddon,
    noCategories: isAddon && categoriesLoaded && addonCategoryCount === 0,
    pager,
    selectedCategoryId,
    selectCategory,
    categoriesError,
    categoriesLoading: (isXtream || isAddon) && !missingSecret && !categoriesLoaded && !categoriesError && !(isAddon && sourceError),
    retryCategories,
    searchQuery,
    setSearchQuery,
    isSearchPending: searchesRemotely ? search.pending || searchState.loading : searchQuery !== deferredQuery,
    searchesRemotely,
    searchStatus: searchesRemotely && (search.pending || searchFirstPageLoading) ? strings.catalog.addon.searching : null,
    attribution: isTmdbCatalog ? 'tmdb' : null,
    items,
    matchCount: searchesRemotely ? (searchState.total ?? searchItems.length) : filtered.length,
    loadedCount: visibleItems.length,
    appliedQuery,
    loading: searchesRemotely ? searchFirstPageLoading : isAddon ? addonView.firstPageLoading : foreground.active,
    loadingMessage: searchesRemotely
      ? searchFirstPageLoading
        ? strings.catalog.addon.searching
        : null
      : isAddon
        ? addonView.firstPageLoading
          ? strings.catalog.addon.pageLoading
          : null
        : foreground.message,
    banner,
    retry,
    detail,
    openDetail,
    closeDetail,
    updateDetail,
    scrollRef,
    gridRef,
    pendingScrollRef,
    pendingFocusRef,
    routeStateFor,
    openPlayer
  }
}
