import { useState, useReducer, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
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

const loadedLiveCategoryCache = new Set<string>()
const loadedLivePreviewSourceCache = new Set<string>()
const loadedLiveFullSourceCache = new Set<string>()
const syncingLiveFullSourceCache = new Set<string>()

function clearSourceCategoryCache(cache: Set<string>, sourceId: string) {
  const prefix = `${sourceId}:`
  for (const key of cache) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

function clearSourceLiveCaches(sourceId: string) {
  clearSourceCategoryCache(loadedLiveCategoryCache, sourceId)
  loadedLivePreviewSourceCache.delete(sourceId)
  loadedLiveFullSourceCache.delete(sourceId)
  syncingLiveFullSourceCache.delete(sourceId)
}

interface LiveTVRouteState {
  restoreSearchQuery?: string
  restoreSelectedCategoryId?: string | null
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

function useLiveTVPageContent() {
  const routeLocation = useLocation()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [reloadToken, bumpReloadToken] = useReducer((value: number) => value + 1, 0)
  const [
    { error: loadError, foregroundMessage: foregroundLoadingMessage, isForegroundLoading, isBackgroundSyncing },
    dispatchLoad
  ] = useReducer(loadStatusReducer, initialLoadStatus)
  const loadedCatsRef = useRef(loadedLiveCategoryCache)
  const previousSourceIdRef = useRef<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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
    const livePrefix = `${activeSourceId}_live_`
    return selectedCategoryId.startsWith(livePrefix)
      ? selectedCategoryId.replace(livePrefix, '')
      : null
  }, [activeSourceId, selectedCategoryId])
  const retainResetKey = useMemo(
    () => buildCatalogRetainResetKey(activeSourceId, selectedCategoryId),
    [activeSourceId, selectedCategoryId]
  )

  useEffect(() => {
    const state = routeLocation.state as LiveTVRouteState | null
    if (!state) return

    let shouldClearLocationState = false

    if (typeof state.restoreSearchQuery === 'string') {
      setSearchQuery(state.restoreSearchQuery)
      shouldClearLocationState = true
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

    setSearchQuery('')
    setSelectedCategory(null)
    dispatchLoad({ type: 'reset' })
  }, [activeSourceId, setSelectedCategory])

  useEffect(() => {
    if (!activeSourceId) return
    const hasChannelsForSource = channels.some(
      (channel) => channel.sourceId === activeSourceId && channel.type === 'live'
    )
    if (!hasChannelsForSource) clearSourceLiveCaches(activeSourceId)
  }, [channels, activeSourceId])

  useEffect(() => {
    if (!activeSourceId) return
    if (isSourceTypeHydrated(activeSourceId, 'live')) {
      loadedLiveFullSourceCache.add(activeSourceId)
      loadedLivePreviewSourceCache.add(activeSourceId)
    }
  }, [activeSourceId, hydratedSourceIds, isSourceTypeHydrated])

  useEffect(() => {
    if (!activeSourceId) return
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'live' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      try {
        const cats = await xtreamApi.getLiveCategories(creds, { signal: controller.signal })
        if (cancelled) return
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'live'))
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load live categories:', err)
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
        channel.type === 'live' &&
        channel.categoryId === `${activeSourceId}_live_${rawCategoryId}`
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
        const streams = await xtreamApi.getLiveStreams(creds, rawCategoryId, {
          signal: controller.signal
        })
        if (cancelled) return
        addChannels(xtreamApi.liveStreamsToChannels(streams, creds, activeSourceId))
        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load live streams:', err)
        dispatchLoad({ type: 'failed', message: err instanceof Error ? err.message : 'Kanallar yüklenemedi' })
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
    if (!activeSourceId || rawCategoryId) return
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    let cancelled = false
    const controller = new AbortController()

    const syncSource = async () => {
      if (isSourceTypeHydrated(activeSourceId, 'live')) {
        loadedLiveFullSourceCache.add(activeSourceId)
        loadedLivePreviewSourceCache.add(activeSourceId)
        return
      }

      const hasSourceChannels = channels.some(
        (channel) => channel.sourceId === activeSourceId && channel.type === 'live'
      )

      if (!loadedLivePreviewSourceCache.has(activeSourceId) && !hasSourceChannels) {
        dispatchLoad({ type: 'foregroundStart', message: 'Kanallar hızlı ön izleme listesiyle açılıyor...' })

        try {
          const previewStreams = await xtreamApi.getLivePreviewStreams(creds, 500, {
            signal: controller.signal
          })
          if (cancelled) return
          addChannels(xtreamApi.liveStreamsToChannels(previewStreams, creds, activeSourceId))
          loadedLivePreviewSourceCache.add(activeSourceId)
        } catch (err) {
          if (cancelled) return
          console.error('Failed to load live preview:', err)
          dispatchLoad({ type: 'failed', message: err instanceof Error ? err.message : 'Kanallar yüklenemedi' })
          return
        } finally {
          if (!cancelled) {
            dispatchLoad({ type: 'foregroundEnd' })
          }
        }
      } else if (hasSourceChannels) {
        loadedLivePreviewSourceCache.add(activeSourceId)
      }

      if (loadedLiveFullSourceCache.has(activeSourceId) || syncingLiveFullSourceCache.has(activeSourceId)) {
        return
      }

      // Sync live first (priority), then vod+series sequentially in background
      if (!cancelled) dispatchLoad({ type: 'backgroundSyncing', value: true })
      syncingLiveFullSourceCache.add(activeSourceId)
      void ensureStagedSync(activeSourceId, 'live', creds)
        .then(() => {
          if (useStore.getState().isSourceTypeHydrated(activeSourceId, 'live')) {
            loadedLiveFullSourceCache.add(activeSourceId)
          }
        })
        .finally(() => {
          syncingLiveFullSourceCache.delete(activeSourceId)
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
    source,
    channels,
    hydratedSourceIds,
    getXtreamCredentials,
    addChannels,
    isSourceTypeHydrated,
    reloadToken
  ])

  const filtered = useMemo(() => {
    let list = channels.filter((c) => c.type === 'live')

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
  const displayedChannels = useRetainedListWhileLoading(filtered, isForegroundLoading, retainResetKey)
  const isPreviewMode =
    !rawCategoryId &&
    source?.type === 'xtream' &&
    !!activeSourceId &&
    !loadedLiveFullSourceCache.has(activeSourceId)
  const showBlockingLoader = isForegroundLoading && displayedChannels.length === 0
  const showInlineLoader = isForegroundLoading && displayedChannels.length > 0

  const handlePlay = useCallback(
    (channel: Channel) => {
      if (!isPlayableChannel(channel)) return
      playChannel(channel)
      setMiniPlayer(false)
      openPlayerFromRoute({
        location: routeLocation,
        navigate,
        returnState: {
          restoreSearchQuery: searchQuery,
          restoreSelectedCategoryId: selectedCategoryId,
          restoreScrollTop: scrollContainerRef.current?.scrollTop ?? 0
        },
        setPlayerReturnTarget
      })
    },
    [routeLocation, navigate, playChannel, searchQuery, selectedCategoryId, setMiniPlayer, setPlayerReturnTarget]
  )

  return (
    <div className="flex h-full gap-3 p-3">
      <div className="rounded-lg border border-surface-800 bg-surface-900 w-64 shrink-0 overflow-y-auto p-3">
        <CategoryList filter="live" />
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
                    ? 'Ön izleme listesi gösteriliyor, tam liste arka planda tamamlanıyor'
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
                  clearSourceLiveCaches(activeSourceId)
                } else {
                  loadedCatsRef.current.clear()
                  loadedLivePreviewSourceCache.clear()
                  loadedLiveFullSourceCache.clear()
                  syncingLiveFullSourceCache.clear()
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
                {foregroundLoadingMessage || 'Kanallar yükleniyor...'}
              </p>
            </div>
          </div>
        ) : (
          <div className={showInlineLoader ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
            <ChannelGrid channels={displayedChannels} onPlay={handlePlay} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function LiveTVPage() {
  return useLiveTVPageContent()
}
