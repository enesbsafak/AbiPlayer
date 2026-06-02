import { useState, useReducer, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { VODGrid } from '@/components/vod/VODGrid'
import { SeriesDetail } from '@/components/series/SeriesDetail'
import { xtreamApi } from '@/services/xtream-api'
import { openPlayerFromRoute } from '@/services/player-navigation'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'
import { useRetainedListWhileLoading } from '@/hooks/useRetainedListWhileLoading'
import { buildCatalogRetainResetKey } from '@/services/catalog-view'
import { ensureStagedSync } from '@/services/background-sync'
import { normalizeSearchText } from '@/services/text-normalize'

const loadedSeriesCategoryCache = new Set<string>()
const loadedSeriesPreviewSourceCache = new Set<string>()
const loadedSeriesFullSourceCache = new Set<string>()
const syncingSeriesFullSourceCache = new Set<string>()

function clearSourceCategoryCache(cache: Set<string>, sourceId: string) {
  const prefix = `${sourceId}:`
  for (const key of cache) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

function clearSourceSeriesCaches(sourceId: string) {
  clearSourceCategoryCache(loadedSeriesCategoryCache, sourceId)
  loadedSeriesPreviewSourceCache.delete(sourceId)
  loadedSeriesFullSourceCache.delete(sourceId)
  syncingSeriesFullSourceCache.delete(sourceId)
}

interface SeriesSelectionState {
  seriesId: number
  sourceId: string
  seasonNumber?: number
}

interface SeriesRouteState {
  restoreSearchQuery?: string
  restoreSelectedCategoryId?: string | null
  restoreSelectedSeries?: SeriesSelectionState
  restoreScrollTop?: number
}

interface LoadStatus {
  error: string | null
  foregroundMessage: string | null
  isForegroundLoading: boolean
  isBackgroundSyncing: boolean
}

type LoadStatusAction =
  | { type: 'foregroundStart'; message: string }
  | { type: 'foregroundEnd' }
  | { type: 'failed'; message: string }
  | { type: 'backgroundSyncing'; value: boolean }
  | { type: 'stopLoading' }
  | { type: 'reset' }

const initialLoadStatus: LoadStatus = {
  error: null,
  foregroundMessage: null,
  isForegroundLoading: false,
  isBackgroundSyncing: false
}

function loadStatusReducer(state: LoadStatus, action: LoadStatusAction): LoadStatus {
  switch (action.type) {
    case 'foregroundStart':
      return { ...state, error: null, foregroundMessage: action.message, isForegroundLoading: true }
    case 'foregroundEnd':
      return { ...state, foregroundMessage: null, isForegroundLoading: false }
    case 'failed':
      return { ...state, error: action.message }
    case 'backgroundSyncing':
      return { ...state, isBackgroundSyncing: action.value }
    case 'stopLoading':
      return { ...state, foregroundMessage: null, isForegroundLoading: false, isBackgroundSyncing: false }
    case 'reset':
      return initialLoadStatus
    default:
      return state
  }
}

interface SeriesPageState {
  searchQuery: string
  selectedSeries: SeriesSelectionState | null
}

type SeriesPageAction =
  | { type: 'setSearchQuery'; value: string }
  | { type: 'selectSeries'; value: SeriesSelectionState | null }
  | { type: 'setSeasonNumber'; value: number }
  | { type: 'restoreRoute'; searchQuery?: string; selectedSeries?: SeriesSelectionState }
  | { type: 'resetSource' }

const initialSeriesPageState: SeriesPageState = {
  searchQuery: '',
  selectedSeries: null
}

function seriesPageReducer(state: SeriesPageState, action: SeriesPageAction): SeriesPageState {
  switch (action.type) {
    case 'setSearchQuery':
      return state.searchQuery === action.value ? state : { ...state, searchQuery: action.value }
    case 'selectSeries':
      return state.selectedSeries === action.value ? state : { ...state, selectedSeries: action.value }
    case 'setSeasonNumber':
      if (!state.selectedSeries || state.selectedSeries.seasonNumber === action.value) return state
      return { ...state, selectedSeries: { ...state.selectedSeries, seasonNumber: action.value } }
    case 'restoreRoute':
      return {
        searchQuery: action.searchQuery ?? state.searchQuery,
        selectedSeries: action.selectedSeries ?? state.selectedSeries
      }
    case 'resetSource':
      return initialSeriesPageState
    default:
      return state
  }
}

function useSeriesPageContent() {
  const routeLocation = useLocation()
  const navigate = useNavigate()
  const [pageState, dispatchPage] = useReducer(seriesPageReducer, initialSeriesPageState)
  const [reloadToken, bumpReloadToken] = useReducer((value: number) => value + 1, 0)
  const [
    { error: loadError, foregroundMessage: foregroundLoadingMessage, isForegroundLoading, isBackgroundSyncing },
    dispatchLoad
  ] = useReducer(loadStatusReducer, initialLoadStatus)
  const loadedCatsRef = useRef(loadedSeriesCategoryCache)
  const previousSourceIdRef = useRef<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { searchQuery, selectedSeries } = pageState
  const setSearchQuery = useCallback((value: string) => {
    dispatchPage({ type: 'setSearchQuery', value })
  }, [])

  const channels = useStore((s) => s.channels)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const hydratedSourceIds = useStore((s) => s.hydratedSourceIds)
  const isSourceTypeHydrated = useStore((s) => s.isSourceTypeHydrated)
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const addChannels = useStore((s) => s.addChannels)
  const addCategories = useStore((s) => s.addCategories)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const categories = useStore((s) => s.categories)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)

  const source = useMemo(
    () => sources.find((item) => item.id === activeSourceId) ?? null,
    [sources, activeSourceId]
  )
  const rawCategoryId = useMemo(() => {
    if (!activeSourceId || !selectedCategoryId) return null
    const seriesPrefix = `${activeSourceId}_series_`
    return selectedCategoryId.startsWith(seriesPrefix)
      ? selectedCategoryId.replace(seriesPrefix, '')
      : null
  }, [activeSourceId, selectedCategoryId])
  const retainResetKey = useMemo(
    () => buildCatalogRetainResetKey(activeSourceId, selectedCategoryId),
    [activeSourceId, selectedCategoryId]
  )

  useEffect(() => {
    const state = routeLocation.state as SeriesRouteState | null
    if (!state) return

    let shouldClearLocationState = false

    const restore = state?.restoreSelectedSeries
    let restoredSeries: SeriesSelectionState | undefined
    if (
      restore &&
      typeof restore.seriesId === 'number' &&
      Number.isFinite(restore.seriesId) &&
      typeof restore.sourceId === 'string'
    ) {
      restoredSeries = restore
      shouldClearLocationState = true
    }

    let restoredSearchQuery: string | undefined
    if (typeof state.restoreSearchQuery === 'string') {
      restoredSearchQuery = state.restoreSearchQuery
      shouldClearLocationState = true
    }

    if (restoredSeries || restoredSearchQuery !== undefined) {
      dispatchPage({ type: 'restoreRoute', selectedSeries: restoredSeries, searchQuery: restoredSearchQuery })
    }

    if ('restoreSelectedCategoryId' in state) {
      setSelectedCategory(
        typeof state.restoreSelectedCategoryId === 'string' ? state.restoreSelectedCategoryId : null
      )
      shouldClearLocationState = true
    }

    if (typeof state.restoreScrollTop === 'number') {
      const scrollTop = state.restoreScrollTop
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollTop
        }
      })
      shouldClearLocationState = true
    }

    if (!shouldClearLocationState) return

    navigate(
      {
        pathname: routeLocation.pathname,
        search: routeLocation.search,
        hash: routeLocation.hash
      },
      { replace: true, state: null }
    )
  }, [routeLocation.hash, routeLocation.pathname, routeLocation.search, routeLocation.state, navigate, setSelectedCategory])

  useEffect(() => {
    const previousSourceId = previousSourceIdRef.current
    previousSourceIdRef.current = activeSourceId

    if (previousSourceId === null) return
    if (previousSourceId === activeSourceId) return

    dispatchPage({ type: 'resetSource' })
    setSelectedCategory(null)
    dispatchLoad({ type: 'reset' })
  }, [activeSourceId, setSelectedCategory])

  useEffect(() => {
    if (!activeSourceId) return
    const hasChannelsForSource = channels.some(
      (channel) => channel.sourceId === activeSourceId && channel.type === 'series'
    )
    if (!hasChannelsForSource) clearSourceSeriesCaches(activeSourceId)
  }, [channels, activeSourceId])

  useEffect(() => {
    if (!activeSourceId) return
    if (isSourceTypeHydrated(activeSourceId, 'series')) {
      loadedSeriesFullSourceCache.add(activeSourceId)
      loadedSeriesPreviewSourceCache.add(activeSourceId)
    }
  }, [activeSourceId, hydratedSourceIds, isSourceTypeHydrated])

  useEffect(() => {
    if (!activeSourceId) return
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'series' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      try {
        const cats = await xtreamApi.getSeriesCategories(creds, { signal: controller.signal })
        if (cancelled) return
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'series'))
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load series categories:', err)
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [activeSourceId, source, categories, getXtreamCredentials, addCategories])

  useEffect(() => {
    if (!activeSourceId || !rawCategoryId) return
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    const cacheKey = `${activeSourceId}:${rawCategoryId}`
    if (loadedCatsRef.current.has(cacheKey)) return

    const hasCategoryInMemory = channels.some(
      (channel) =>
        channel.sourceId === activeSourceId &&
        channel.type === 'series' &&
        channel.categoryId === `${activeSourceId}_series_${rawCategoryId}`
    )

    if (hasCategoryInMemory) {
      loadedCatsRef.current.add(cacheKey)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      dispatchLoad({ type: 'foregroundStart', message: 'Seçili kategori yükleniyor...' })

      try {
        const series = await xtreamApi.getSeries(creds, rawCategoryId, {
          signal: controller.signal
        })
        if (cancelled) return
        addChannels(xtreamApi.seriesToChannels(series, activeSourceId))
        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load series:', err)
        dispatchLoad({ type: 'failed', message: err instanceof Error ? err.message : 'Diziler yüklenemedi' })
      } finally {
        if (!cancelled) {
          dispatchLoad({ type: 'foregroundEnd' })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    activeSourceId,
    rawCategoryId,
    source,
    channels,
    getXtreamCredentials,
    addChannels,
    isSourceTypeHydrated,
    reloadToken
  ])

  useEffect(() => {
    if (!activeSourceId || rawCategoryId || selectedSeries) return
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    let cancelled = false
    const controller = new AbortController()

    const syncSource = async () => {
      if (isSourceTypeHydrated(activeSourceId, 'series')) {
        loadedSeriesFullSourceCache.add(activeSourceId)
        loadedSeriesPreviewSourceCache.add(activeSourceId)
        return
      }

      const hasSourceItems = channels.some(
        (channel) => channel.sourceId === activeSourceId && channel.type === 'series'
      )

      if (!loadedSeriesPreviewSourceCache.has(activeSourceId) && !hasSourceItems) {
        dispatchLoad({ type: 'foregroundStart', message: 'Diziler hızlı ön izleme listesiyle açılıyor...' })

        try {
          const previewSeries = await xtreamApi.getSeriesPreviewStreams(creds, 500, {
            signal: controller.signal
          })
          if (cancelled) return
          addChannels(xtreamApi.seriesToChannels(previewSeries, activeSourceId))
          loadedSeriesPreviewSourceCache.add(activeSourceId)
        } catch (err) {
          if (cancelled) return
          console.error('Failed to load series preview:', err)
          dispatchLoad({ type: 'failed', message: err instanceof Error ? err.message : 'Diziler yüklenemedi' })
          return
        } finally {
          if (!cancelled) {
            dispatchLoad({ type: 'foregroundEnd' })
          }
        }
      } else if (hasSourceItems) {
        loadedSeriesPreviewSourceCache.add(activeSourceId)
      }

      if (loadedSeriesFullSourceCache.has(activeSourceId) || syncingSeriesFullSourceCache.has(activeSourceId)) {
        return
      }

      if (!cancelled) dispatchLoad({ type: 'backgroundSyncing', value: true })
      syncingSeriesFullSourceCache.add(activeSourceId)
      void ensureStagedSync(activeSourceId, 'series', creds)
        .then(() => {
          if (useStore.getState().isSourceTypeHydrated(activeSourceId, 'series')) {
            loadedSeriesFullSourceCache.add(activeSourceId)
          }
        })
        .finally(() => {
          syncingSeriesFullSourceCache.delete(activeSourceId)
          if (!cancelled) dispatchLoad({ type: 'backgroundSyncing', value: false })
        })
        .catch(() => undefined)
    }

    void syncSource()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    activeSourceId,
    rawCategoryId,
    selectedSeries,
    source,
    channels,
    hydratedSourceIds,
    getXtreamCredentials,
    addChannels,
    isSourceTypeHydrated,
    reloadToken
  ])

  const filtered = useMemo(() => {
    let list = channels.filter((c) => c.type === 'series')

    if (activeSourceId) {
      list = list.filter((c) => c.sourceId === activeSourceId)
    }
    if (selectedCategoryId) {
      list = list.filter((c) => c.categoryId === selectedCategoryId)
    }
    if (searchQuery) {
      const q = normalizeSearchText(searchQuery)
      list = list.filter((c) => normalizeSearchText(c.name).includes(q))
    }

    return list
  }, [channels, activeSourceId, selectedCategoryId, searchQuery])
  const displayedItems = useRetainedListWhileLoading(filtered, isForegroundLoading, retainResetKey)
  const isPreviewMode =
    !rawCategoryId &&
    source?.type === 'xtream' &&
    !!activeSourceId &&
    !loadedSeriesFullSourceCache.has(activeSourceId)
  const showBlockingLoader = isForegroundLoading && displayedItems.length === 0
  const showInlineLoader = isForegroundLoading && displayedItems.length > 0

  const handleSeasonChange = useCallback((seasonNumber: number) => {
    dispatchPage({ type: 'setSeasonNumber', value: seasonNumber })
  }, [])

  const handleSeriesClick = useCallback((item: Channel) => {
    if (item.seriesId) {
      dispatchPage({ type: 'selectSeries', value: { seriesId: item.seriesId, sourceId: item.sourceId } })
    }
  }, [])

  const handlePlayEpisode = useCallback(
    (url: string, title: string, seasonNumber?: number) => {
      const episodeChannel = {
        id: `ep_${Date.now()}`,
        name: title,
        streamUrl: url,
        sourceId: '',
        type: 'vod' as const
      }
      if (!isPlayableChannel(episodeChannel)) return
      playChannel(episodeChannel)
      setMiniPlayer(false)
      openPlayerFromRoute({
        location: routeLocation,
        navigate,
        returnState: {
          restoreSearchQuery: searchQuery,
          restoreSelectedCategoryId: selectedCategoryId,
          restoreScrollTop: scrollContainerRef.current?.scrollTop ?? 0,
          ...(selectedSeries
            ? {
                restoreSelectedSeries: {
                  ...selectedSeries,
                  seasonNumber: seasonNumber ?? selectedSeries.seasonNumber
                }
              }
            : {})
        },
        setPlayerReturnTarget
      })
    },
    [routeLocation, navigate, playChannel, searchQuery, selectedCategoryId, selectedSeries, setMiniPlayer, setPlayerReturnTarget]
  )

  if (selectedSeries) {
    return (
      <div className="h-full p-3">
        <div className="rounded-lg border border-surface-800 bg-surface-900 h-full overflow-y-auto p-5">
          <SeriesDetail
            seriesId={selectedSeries.seriesId}
            sourceId={selectedSeries.sourceId}
            initialSeasonNumber={selectedSeries.seasonNumber}
            onBack={() => dispatchPage({ type: 'selectSeries', value: null })}
            onSeasonChange={handleSeasonChange}
            onPlayEpisode={handlePlayEpisode}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-3 p-3">
      <div className="rounded-lg border border-surface-800 bg-surface-900 w-64 shrink-0 overflow-y-auto p-3">
        <CategoryList filter="series" />
      </div>
      <div ref={scrollContainerRef} className="rounded-lg border border-surface-800 bg-surface-900 flex-1 overflow-y-auto p-5">
        <div className="mb-5">
          <ChannelSearch value={searchQuery} onSearch={setSearchQuery} />
        </div>

        {isPreviewMode && !loadError && (
          <div className="mb-4 rounded-lg border border-sky-400/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            <div className="flex items-start gap-3">
              {(isBackgroundSyncing || isForegroundLoading) && <Spinner size={16} className="mt-0.5 text-sky-200" />}
              <div>
                <p className="font-medium">
                  {isBackgroundSyncing
                    ? 'Ön izleme listesi gösteriliyor, tam dizi listesi arka planda tamamlanıyor'
                    : 'Bu sayfa önce hızlı bir ön izleme listesiyle açılıyor'}
                </p>
                <p className="mt-1 text-xs leading-5 text-sky-100/80">
                  Tam senkron bitene kadar arama ve toplam sonuç sayısı eksik olabilir.
                </p>
              </div>
            </div>
          </div>
        )}

        {loadError && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span>{loadError}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (activeSourceId) {
                  clearSourceSeriesCaches(activeSourceId)
                } else {
                  loadedCatsRef.current.clear()
                  loadedSeriesPreviewSourceCache.clear()
                  loadedSeriesFullSourceCache.clear()
                  syncingSeriesFullSourceCache.clear()
                }
                dispatchLoad({ type: 'stopLoading' })
                bumpReloadToken()
              }}
            >
              Tekrar Dene
            </Button>
          </div>
        )}

        {showInlineLoader && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-900 px-4 py-3 text-sm text-surface-200">
            <Spinner size={16} />
            <span>{foregroundLoadingMessage || 'İçerikler yükleniyor...'}</span>
          </div>
        )}

        {showBlockingLoader ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3 text-center">
              <Spinner size={32} />
              <p className="text-sm text-surface-300">
                {foregroundLoadingMessage || 'Diziler yükleniyor...'}
              </p>
            </div>
          </div>
        ) : (
          <div className={showInlineLoader ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
            <VODGrid items={displayedItems} onPlay={handleSeriesClick} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function SeriesPage() {
  return useSeriesPageContent()
}
