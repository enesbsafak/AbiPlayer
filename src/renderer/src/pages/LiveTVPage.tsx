import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
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
}

export default function LiveTVPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [foregroundLoadingMessage, setForegroundLoadingMessage] = useState<string | null>(null)
  const [isForegroundLoading, setIsForegroundLoading] = useState(false)
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false)
  const loadedCatsRef = useRef(loadedLiveCategoryCache)
  const previousSourceIdRef = useRef<string | null>(null)

  const channels = useStore((s) => s.channels)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const hydratedSourceIds = useStore((s) => s.hydratedSourceIds)
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const channelFilter = useStore((s) => s.channelFilter)
  const setChannelFilter = useStore((s) => s.setChannelFilter)
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
    const state = location.state as LiveTVRouteState | null
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

    if (!shouldClearLocationState) return

    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash
      },
      { replace: true, state: null }
    )
  }, [location.hash, location.pathname, location.search, location.state, navigate, setSelectedCategory])

  useEffect(() => {
    setChannelFilter('live')
  }, [setChannelFilter])

  useEffect(() => {
    const previousSourceId = previousSourceIdRef.current
    previousSourceIdRef.current = activeSourceId

    if (previousSourceId === null) return
    if (previousSourceId === activeSourceId) return

    setSearchQuery('')
    setSelectedCategory(null)
    setLoadError(null)
    setForegroundLoadingMessage(null)
    setIsForegroundLoading(false)
    setIsBackgroundSyncing(false)
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
    if (hydratedSourceIds[activeSourceId]) {
      loadedLiveFullSourceCache.add(activeSourceId)
      loadedLivePreviewSourceCache.add(activeSourceId)
    }
  }, [activeSourceId, hydratedSourceIds])

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
      setLoadError(null)
      setForegroundLoadingMessage('Secili kategori yukleniyor...')
      setIsForegroundLoading(true)

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
        setLoadError(err instanceof Error ? err.message : 'Kanallar yuklenemedi')
      } finally {
        if (!cancelled) {
          setIsForegroundLoading(false)
          setForegroundLoadingMessage(null)
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
      if (hydratedSourceIds[activeSourceId]) {
        loadedLiveFullSourceCache.add(activeSourceId)
        loadedLivePreviewSourceCache.add(activeSourceId)
        return
      }

      const hasSourceChannels = channels.some(
        (channel) => channel.sourceId === activeSourceId && channel.type === 'live'
      )

      if (!loadedLivePreviewSourceCache.has(activeSourceId) && !hasSourceChannels) {
        setLoadError(null)
        setForegroundLoadingMessage('Kanallar hizli on izleme listesiyle aciliyor...')
        setIsForegroundLoading(true)

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
          setLoadError(err instanceof Error ? err.message : 'Kanallar yuklenemedi')
          return
        } finally {
          if (!cancelled) {
            setIsForegroundLoading(false)
            setForegroundLoadingMessage(null)
          }
        }
      } else if (hasSourceChannels) {
        loadedLivePreviewSourceCache.add(activeSourceId)
      }

      if (loadedLiveFullSourceCache.has(activeSourceId) || syncingLiveFullSourceCache.has(activeSourceId)) {
        return
      }

      syncingLiveFullSourceCache.add(activeSourceId)
      if (!cancelled) setIsBackgroundSyncing(true)

      try {
        const allStreams = await xtreamApi.getLiveStreams(creds, undefined, {
          signal: controller.signal
        })
        if (cancelled) return
        addChannels(xtreamApi.liveStreamsToChannels(allStreams, creds, activeSourceId))
        loadedLiveFullSourceCache.add(activeSourceId)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fully sync live channels:', err)
        setLoadError(
          err instanceof Error
            ? `Tam kanal listesi arka planda tamamlanamadi: ${err.message}`
            : 'Tam kanal listesi arka planda tamamlanamadi'
        )
      } finally {
        syncingLiveFullSourceCache.delete(activeSourceId)
        if (!cancelled) setIsBackgroundSyncing(false)
      }
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
    reloadToken
  ])

  const filtered = useMemo(() => {
    let list = channels.filter((c) => c.type === channelFilter)

    if (activeSourceId) {
      list = list.filter((c) => c.sourceId === activeSourceId)
    }
    if (selectedCategoryId) {
      list = list.filter((c) => c.categoryId === selectedCategoryId)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(q))
    }

    return list
  }, [channels, activeSourceId, channelFilter, selectedCategoryId, searchQuery])
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
        location,
        navigate,
        returnState: {
          restoreSearchQuery: searchQuery,
          restoreSelectedCategoryId: selectedCategoryId
        },
        setPlayerReturnTarget
      })
    },
    [location, navigate, playChannel, searchQuery, selectedCategoryId, setMiniPlayer, setPlayerReturnTarget]
  )

  return (
    <div className="flex h-full gap-3 p-3">
      <div className="panel-glass w-64 shrink-0 overflow-y-auto rounded-2xl p-3">
        <CategoryList />
      </div>
        <div className="panel-glass flex-1 overflow-y-auto rounded-2xl p-5">
          <div className="mb-5">
            <ChannelSearch value={searchQuery} onSearch={setSearchQuery} />
          </div>

        {isPreviewMode && !loadError && (
          <div className="mb-4 rounded-xl border border-sky-400/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            <div className="flex items-start gap-3">
              {(isBackgroundSyncing || isForegroundLoading) && <Spinner size={16} className="mt-0.5 text-sky-200" />}
              <div>
                <p className="font-medium">
                  {isBackgroundSyncing
                    ? 'On izleme listesi gosteriliyor, tam liste arka planda tamamlaniyor'
                    : 'Bu sayfa once hizli bir on izleme listesiyle aciliyor'}
                </p>
                <p className="mt-1 text-xs leading-5 text-sky-100/80">
                  Tam senkron bitene kadar arama ve toplam sonuc sayisi eksik olabilir.
                </p>
              </div>
            </div>
          </div>
        )}

        {loadError && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">
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
                setIsForegroundLoading(false)
                setForegroundLoadingMessage(null)
                setIsBackgroundSyncing(false)
                setReloadToken((v) => v + 1)
              }}
            >
              Tekrar Dene
            </Button>
          </div>
        )}

        {showInlineLoader && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-surface-200">
            <Spinner size={16} />
            <span>{foregroundLoadingMessage || 'Icerikler yukleniyor...'}</span>
          </div>
        )}

        {showBlockingLoader ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3 text-center">
              <Spinner size={32} />
              <p className="text-sm text-surface-300">
                {foregroundLoadingMessage || 'Kanallar yukleniyor...'}
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
