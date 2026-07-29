import { useEffect, useReducer, useRef, useState } from 'react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { ensureStagedSync } from '@/services/background-sync'

// Message and progress bar come from one source so they can never drift apart.
export const BOOTSTRAP_STAGES = {
  idle: { message: 'İçerikler taranıyor...', progress: 0.1 },
  categories: { message: 'Kategoriler yükleniyor...', progress: 0.4 },
  preview: { message: 'Ön izleme yükleniyor...', progress: 0.75 },
  catalog: { message: 'Tam katalog arka planda yükleniyor...', progress: 0.95 }
} as const

export type BootstrapStage = keyof typeof BOOTSTRAP_STAGES

export interface HomeBootstrap {
  /** Failure from the home bootstrap itself (categories/preview fetch). */
  error: string | null
  isBootstrapping: boolean
  stage: BootstrapStage
  /** Clears attempt bookkeeping and asks every source to reconnect. */
  retry: () => void
}

/**
 * Loads just enough of the active Xtream source to fill the dashboard:
 * categories first, then a small preview, then the full catalog in background.
 */
export function useHomeBootstrap(): HomeBootstrap {
  const channels = useStore((s) => s.channels)
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const hydratedSourceIds = useStore((s) => s.hydratedSourceIds)
  const xtreamAuth = useStore((s) => s.xtreamAuth)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const addChannels = useStore((s) => s.addChannels)
  const addCategories = useStore((s) => s.addCategories)
  const setPlaylistLoading = useStore((s) => s.setPlaylistLoading)
  const markSourceHydrated = useStore((s) => s.markSourceHydrated)
  const requestSourceReconnect = useStore((s) => s.requestSourceReconnect)

  const [error, setError] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [stage, setStage] = useState<BootstrapStage>('idle')
  const [reloadToken, bumpReloadToken] = useReducer((value: number) => value + 1, 0)
  const attemptedRef = useRef<Set<string> | null>(null)
  if (attemptedRef.current === null) attemptedRef.current = new Set<string>()
  const attempted = attemptedRef.current

  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((item) => item.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const hasChannelsForSource = channels.some((channel) => channel.sourceId === activeSourceId)
    if (!hasChannelsForSource) attempted.delete(activeSourceId)
    if (hydratedSourceIds[activeSourceId]) return
    if (!xtreamAuth[activeSourceId]) return
    if (attempted.has(activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    attempted.add(activeSourceId)
    let cancelled = false
    const controller = new AbortController()

    const bootstrap = async () => {
      setError(null)
      setIsBootstrapping(true)
      setStage('categories')
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
        setStage('preview')
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
        setStage('catalog')
        void ensureStagedSync(activeSourceId, 'live', creds)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Ana sayfa içerikleri yüklenemedi')
      } finally {
        // `isLoadingPlaylist` lives in the global store, so it MUST be released
        // even when this run was superseded or the page unmounted mid-flight —
        // otherwise it stays true for the rest of the session and pins the
        // full-screen loader on every later visit. Local setState after unmount
        // is a no-op in React 18, so no guard is needed here.
        setPlaylistLoading(false)
        setIsBootstrapping(false)
        setStage('idle')
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    activeSourceId,
    attempted,
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

  const retry = () => {
    if (activeSourceId) {
      attempted.delete(activeSourceId)
      markSourceHydrated(activeSourceId, false)
    }
    setError(null)
    requestSourceReconnect()
    bumpReloadToken()
  }

  return { error, isBootstrapping, stage, retry }
}
