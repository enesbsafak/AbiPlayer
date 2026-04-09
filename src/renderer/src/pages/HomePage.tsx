import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tv, Film, Clapperboard, Star, Plus, Activity, RefreshCw } from 'lucide-react'
import { useStore } from '@/store'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'
import { xtreamApi } from '@/services/xtream-api'
import { ensureStagedSync } from '@/services/background-sync'
import { isPlayableChannel } from '@/services/playback'
import { openPlayerFromRoute } from '@/services/player-navigation'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

export default function HomePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const channels = useStore((s) => s.channels)
  const sources = useStore((s) => s.sources)
  const favoriteIds = useStore((s) => s.favoriteIds)
  const isLoading = useStore((s) => s.isLoading)
  const isLoadingPlaylist = useStore((s) => s.isLoadingPlaylist)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const hydratedSourceIds = useStore((s) => s.hydratedSourceIds)
  const xtreamAuth = useStore((s) => s.xtreamAuth)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const addChannels = useStore((s) => s.addChannels)
  const addCategories = useStore((s) => s.addCategories)
  const setPlaylistLoading = useStore((s) => s.setPlaylistLoading)
  const markSourceHydrated = useStore((s) => s.markSourceHydrated)
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)
  const syncProgress = useStore((s) => activeSourceId ? s.syncProgress[activeSourceId] : undefined)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [isBootstrappingSource, setIsBootstrappingSource] = useState(false)
  const [scanMessage, setScanMessage] = useState('İçerikler taranıyor...')
  const [reloadToken, setReloadToken] = useState(0)
  const bootstrapAttemptedRef = useRef(new Set<string>())

  const handlePlay = useCallback((channel: Channel) => {
    if (!isPlayableChannel(channel)) {
      if (channel.type === 'series') navigate('/series')
      return
    }

    playChannel(channel)
    setMiniPlayer(false)
    openPlayerFromRoute({ location, navigate, setPlayerReturnTarget })
  }, [location, playChannel, setMiniPlayer, navigate, setPlayerReturnTarget])

  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((item) => item.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const hasChannelsForSource = channels.some((channel) => channel.sourceId === activeSourceId)
    if (!hasChannelsForSource) bootstrapAttemptedRef.current.delete(activeSourceId)
    if (hydratedSourceIds[activeSourceId]) return
    if (!xtreamAuth[activeSourceId]) return
    if (bootstrapAttemptedRef.current.has(activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    bootstrapAttemptedRef.current.add(activeSourceId)
    let cancelled = false
    const controller = new AbortController()

    const bootstrap = async () => {
      setBootstrapError(null)
      setIsBootstrappingSource(true)
      setScanMessage('Kategoriler yükleniyor...')
      setPlaylistLoading(true)
      try {
        // Step 1: Fetch categories (small, fast — ~18KB total)
        const [liveCats, vodCats, seriesCats] = await Promise.all([
          xtreamApi.getLiveCategories(creds, { signal: controller.signal }).catch(() => []),
          xtreamApi.getVodCategories(creds, { signal: controller.signal }).catch(() => []),
          xtreamApi.getSeriesCategories(creds, { signal: controller.signal }).catch(() => [])
        ])
        if (cancelled) return
        addCategories([
          ...xtreamApi.categoriesToApp(liveCats, activeSourceId, 'live'),
          ...xtreamApi.categoriesToApp(vodCats, activeSourceId, 'vod'),
          ...xtreamApi.categoriesToApp(seriesCats, activeSourceId, 'series')
        ])

        // Step 2: Small preview for dashboard display (~150KB total, fast)
        setScanMessage('Ön izleme yükleniyor...')
        const [livePreview, vodPreview, seriesPreview] = await Promise.all([
          xtreamApi.getLivePreviewStreams(creds, 50, { signal: controller.signal }).catch(() => []),
          xtreamApi.getVodPreviewStreams(creds, 30, { signal: controller.signal }).catch(() => []),
          xtreamApi.getSeriesPreviewStreams(creds, 30, { signal: controller.signal }).catch(() => [])
        ])
        if (cancelled) return
        addChannels([
          ...xtreamApi.liveStreamsToChannels(livePreview, creds, activeSourceId),
          ...xtreamApi.vodStreamsToChannels(vodPreview, creds, activeSourceId),
          ...xtreamApi.seriesToChannels(seriesPreview, activeSourceId)
        ])

        // Step 3: Full catalog in background — sequential, not parallel
        // This runs after UI is already showing content, user doesn't wait
        setScanMessage('Tam katalog arka planda yükleniyor...')
        void ensureStagedSync(activeSourceId, 'live', creds)
      } catch (error) {
        if (cancelled) return
        setBootstrapError(error instanceof Error ? error.message : 'Ana sayfa içerikleri yüklenemedi')
      } finally {
        if (!cancelled) {
          setPlaylistLoading(false)
          setIsBootstrappingSource(false)
          setScanMessage('İçerikler taranıyor...')
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    activeSourceId,
    sources,
    channels,
    hydratedSourceIds,
    xtreamAuth,
    getXtreamCredentials,
    addChannels,
    addCategories,
    setPlaylistLoading,
    reloadToken
  ])

  const { recentLive, recentVod, recentSeries, favChannels } = useMemo(() => {
    const live: Channel[] = []
    const vod: Channel[] = []
    const series: Channel[] = []
    const fav: Channel[] = []

    for (const channel of channels) {
      if (live.length < 12 && channel.type === 'live') live.push(channel)
      if (vod.length < 6 && channel.type === 'vod') vod.push(channel)
      if (series.length < 6 && channel.type === 'series') series.push(channel)
      if (fav.length < 6 && favoriteIds.has(channel.id)) fav.push(channel)

      if (live.length >= 12 && vod.length >= 6 && series.length >= 6 && fav.length >= 6) break
    }

    return { recentLive: live, recentVod: vod, recentSeries: series, favChannels: fav }
  }, [channels, favoriteIds])

  if (sources.length === 0) {
    return (
      <div className="h-full p-3">
        <div className="rounded-lg border border-surface-800 bg-surface-900 flex h-full flex-col items-center justify-center gap-6 px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center border border-accent/40 bg-accent/15">
              <Tv size={40} className="text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-white">{APP_NAME}'a Hoş Geldin</h1>
            <p className="rounded-md border border-surface-700 bg-surface-900 px-2.5 py-1 text-xs font-medium text-surface-400">
              {APP_VERSION_LABEL} sürümü test aşamasındadır.
            </p>
            <p className="max-w-md text-surface-300">
              İzlemeye başlamak için Xtream Codes sunucusuna bağlan veya bir M3U listesi içe aktar.
            </p>
            <Button size="lg" onClick={() => navigate('/settings')}>
              <Plus size={20} /> Kaynak Ekle
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const showInitialLoading =
    channels.length === 0 &&
    sources.length > 0 &&
    (isLoading || isLoadingPlaylist || isBootstrappingSource)

  if (showInitialLoading) {
    const loadingMessage =
      isLoading && !isLoadingPlaylist ? 'Kaynaklar bağlanıyor...' : scanMessage

    return (
      <div className="h-full p-3">
        <div className="rounded-lg border border-surface-800 bg-surface-900 flex h-full flex-col items-center justify-center gap-4 text-center">
          <Activity size={20} className="animate-pulse text-accent" />
          <p className="text-sm text-surface-300">{loadingMessage}</p>
          <div className="w-48 h-1.5 rounded-full bg-surface-800 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: '33%' }} />
          </div>
          <p className="text-xs text-surface-500">Kategoriler ve ön izleme yükleniyor</p>
        </div>
      </div>
    )
  }

  if (bootstrapError && channels.length === 0) {
    return (
      <div className="h-full p-3">
        <div className="rounded-lg border border-surface-800 bg-surface-900 flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="max-w-xl text-sm text-red-300">{bootstrapError}</p>
          <Button
            onClick={() => {
              if (activeSourceId) bootstrapAttemptedRef.current.delete(activeSourceId)
              if (activeSourceId) markSourceHydrated(activeSourceId, false)
              setBootstrapError(null)
              setReloadToken((v) => v + 1)
            }}
          >
            <RefreshCw size={16} />
            Yeniden Dene
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 p-4">
      <section className="rounded-lg border border-surface-800 bg-surface-900 relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-8 top-8 h-32 w-32 rounded-full bg-signal/20 blur-3xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-surface-500">Yayın Merkezi</p>
            <h1 className="text-xl font-semibold text-white mt-0.5">{APP_NAME}</h1>
            <p className="mt-1 text-xs text-surface-500">{APP_VERSION_LABEL}</p>
            <p className="mt-1 text-sm text-surface-300">
              Canlı yayın, film ve dizilerde toplam {channels.length} içerik hazır.
            </p>
            {syncProgress?.active && (
              <div className="mt-2 flex items-center gap-3">
                <div className="w-32 h-1.5 rounded-full bg-surface-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-700"
                    style={{ width: `${Math.round((syncProgress.completedTypes / 3) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-surface-500">
                  {syncProgress.currentType
                    ? `${syncProgress.completedTypes}/3 — ${syncProgress.currentType === 'live' ? 'Canlı TV' : syncProgress.currentType === 'vod' ? 'Filmler' : 'Diziler'} yükleniyor`
                    : `${syncProgress.completedTypes}/3 tamamlandı`
                  }
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/search')}>Ara</Button>
            <Button size="sm" onClick={() => navigate('/settings')}>
              <Plus size={16} /> Kaynak Ekle
            </Button>
          </div>
        </div>
      </section>

      {favChannels.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Star size={20} className="text-accent" /> Favoriler
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/favorites')}>Tümünü Gör</Button>
          </div>
          <ChannelGrid channels={favChannels} onPlay={handlePlay} />
        </section>
      )}

      {recentLive.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Tv size={20} className="text-accent" /> Canlı TV
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/live')}>Tümünü Gör</Button>
          </div>
          <ChannelGrid channels={recentLive} onPlay={handlePlay} />
        </section>
      )}

      {recentVod.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Film size={20} className="text-signal" /> Filmler
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/vod')}>Tümünü Gör</Button>
          </div>
          <ChannelGrid channels={recentVod} onPlay={handlePlay} />
        </section>
      )}

      {recentSeries.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Clapperboard size={20} className="text-signal" /> Diziler
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/series')}>Tümünü Gör</Button>
          </div>
          <ChannelGrid channels={recentSeries} onPlay={handlePlay} />
        </section>
      )}
    </div>
  )
}
