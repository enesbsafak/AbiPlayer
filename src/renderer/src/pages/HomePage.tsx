import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tv, Film, Clapperboard, Star, Plus, Activity, RefreshCw } from 'lucide-react'
import { useStore } from '@/store'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'
import { xtreamApi } from '@/services/xtream-api'
import { isPlayableChannel } from '@/services/playback'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

export default function HomePage() {
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
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [isBootstrappingSource, setIsBootstrappingSource] = useState(false)
  const [scanMessage, setScanMessage] = useState('Icerikler taraniyor...')
  const [reloadToken, setReloadToken] = useState(0)
  const bootstrapAttemptedRef = useRef(new Set<string>())

  const handlePlay = useCallback((channel: Channel) => {
    if (!isPlayableChannel(channel)) {
      if (channel.type === 'series') navigate('/series')
      return
    }

    playChannel(channel)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

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
    const bootstrap = async () => {
      setBootstrapError(null)
      setIsBootstrappingSource(true)
      setScanMessage('Kaynak kategorileri taraniyor...')
      setPlaylistLoading(true)
      try {
        const [liveCats, vodCats, seriesCats] = await Promise.all([
          xtreamApi.getLiveCategories(creds).catch(() => []),
          xtreamApi.getVodCategories(creds).catch(() => []),
          xtreamApi.getSeriesCategories(creds).catch(() => [])
        ])
        if (cancelled) return
        addCategories([
          ...xtreamApi.categoriesToApp(liveCats, activeSourceId, 'live'),
          ...xtreamApi.categoriesToApp(vodCats, activeSourceId, 'vod'),
          ...xtreamApi.categoriesToApp(seriesCats, activeSourceId, 'series')
        ])

        setScanMessage('Tum canli, film ve dizi icerikleri taraniyor...')

        // Full catalog scan once per source; keep results in-memory until app closes.
        const livePromise = xtreamApi
          .getLiveStreams(creds)
          .catch(() => xtreamApi.getLivePreviewStreams(creds, 2000))
        const vodPromise = xtreamApi
          .getVodStreams(creds)
          .catch(() => xtreamApi.getVodPreviewStreams(creds, 1500))
        const seriesPromise = xtreamApi
          .getSeries(creds)
          .catch(() => xtreamApi.getSeriesPreviewStreams(creds, 1500))
        const [live, vod, series] = await Promise.all([livePromise, vodPromise, seriesPromise])
        if (cancelled) return

        addChannels([
          ...xtreamApi.liveStreamsToChannels(live, creds, activeSourceId),
          ...xtreamApi.vodStreamsToChannels(vod, creds, activeSourceId),
          ...xtreamApi.seriesToChannels(series, activeSourceId)
        ])
        markSourceHydrated(activeSourceId, true)
      } catch (error) {
        if (cancelled) return
        setBootstrapError(error instanceof Error ? error.message : 'Ana sayfa icerikleri yuklenemedi')
      } finally {
        if (!cancelled) {
          setPlaylistLoading(false)
          setIsBootstrappingSource(false)
          setScanMessage('Icerikler taraniyor...')
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
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
    markSourceHydrated,
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
        <div className="panel-glass flex h-full flex-col items-center justify-center gap-6 rounded-2xl px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/40 bg-accent/15">
              <Tv size={40} className="text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-white">{APP_NAME}'a Hos Geldin</h1>
            <p className="rounded-md border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-medium text-surface-400">
              {APP_VERSION_LABEL} surumu test asamasindadir.
            </p>
            <p className="max-w-md text-surface-300">
              Izlemeye baslamak icin Xtream Codes sunucusuna baglan veya bir M3U listesi ice aktar.
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
      isLoading && !isLoadingPlaylist ? 'Kaynaklar baglaniyor...' : scanMessage

    return (
      <div className="h-full p-3">
        <div className="panel-glass flex h-full flex-col items-center justify-center gap-3 rounded-2xl text-center">
          <Activity size={20} className="animate-pulse text-accent" />
          <p className="text-sm text-surface-300">{loadingMessage}</p>
          <p className="max-w-md text-xs text-surface-400">
            Ilk taramada biraz surebilir. Tarama tamamlaninca ayni oturum boyunca veriler cache'de tutulur.
          </p>
        </div>
      </div>
    )
  }

  if (bootstrapError && channels.length === 0) {
    return (
      <div className="h-full p-3">
        <div className="panel-glass flex h-full flex-col items-center justify-center gap-4 rounded-2xl px-6 text-center">
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
      <section className="panel-glass relative overflow-hidden rounded-2xl p-6">
        <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-8 top-8 h-32 w-32 rounded-full bg-signal/20 blur-3xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-surface-500">Yayin Merkezi</p>
            <h1 className="text-xl font-semibold text-white mt-0.5">{APP_NAME}</h1>
            <p className="mt-1 text-xs text-surface-500">{APP_VERSION_LABEL}</p>
            <p className="mt-1 text-sm text-surface-300">
              Canli yayin, film ve dizilerde toplam {channels.length} icerik hazir.
            </p>
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/favorites')}>Tumunu Gor</Button>
          </div>
          <ChannelGrid channels={favChannels} onPlay={handlePlay} />
        </section>
      )}

      {recentLive.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Tv size={20} className="text-accent" /> Canli TV
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/live')}>Tumunu Gor</Button>
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/vod')}>Tumunu Gor</Button>
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/series')}>Tumunu Gor</Button>
          </div>
          <ChannelGrid channels={recentSeries} onPlay={handlePlay} />
        </section>
      )}
    </div>
  )
}
