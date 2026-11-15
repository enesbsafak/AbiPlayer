import { useEffect, useReducer, useRef, useState } from 'react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { ensureStagedSync } from '@/services/background-sync'
import { catalog } from '@/catalog/catalog-store'
import {
  xtreamCategoriesToRecords,
  xtreamLiveToRecords,
  xtreamSeriesToRecords,
  xtreamVodToRecords
} from '@/catalog/convert'
import { CATALOG_TYPES, type CatalogCategory, type CatalogItem, type CatalogType } from '@/catalog/types'
import type { CatalogStatusMap } from '@/store/playlist-slice'

// Message and progress bar come from one source so they can never drift apart.
export const BOOTSTRAP_STAGES = {
  idle: { message: 'İçerikler taranıyor...', progress: 0.1 },
  categories: { message: 'Kategoriler yükleniyor...', progress: 0.4 },
  preview: { message: 'Ön izleme yükleniyor...', progress: 0.75 },
  catalog: { message: 'Tam katalog arka planda yükleniyor...', progress: 0.95 }
} as const

export type BootstrapStage = keyof typeof BOOTSTRAP_STAGES

/** Any type of the source has items in memory. */
export function sourceHasCatalog(status: CatalogStatusMap, sourceId: string | null): boolean {
  if (!sourceId) return false
  return CATALOG_TYPES.some((type) => status[sourceId]?.[type]?.loaded === true)
}

/** Every type of the source holds a complete list. */
export function sourceCatalogComplete(status: CatalogStatusMap, sourceId: string | null): boolean {
  if (!sourceId) return false
  return CATALOG_TYPES.every((type) => status[sourceId]?.[type]?.complete === true)
}

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
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const hasChannelsForSource = useStore((s) => sourceHasCatalog(s.catalogStatus, activeSourceId))
  const isSourceComplete = useStore((s) => sourceCatalogComplete(s.catalogStatus, activeSourceId))
  const xtreamAuth = useStore((s) => s.xtreamAuth)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const setPlaylistLoading = useStore((s) => s.setPlaylistLoading)
  const replaceSourceCatalog = useStore((s) => s.replaceSourceCatalog)
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

    // Per revision: after a refresh the source is bootstrapped again even
    // though its old items are still on screen.
    const attemptKey = `${activeSourceId}#${catalog.getSourceRevision(activeSourceId)}`
    if (!hasChannelsForSource) attempted.delete(attemptKey)
    if (isSourceComplete) return
    if (!xtreamAuth[activeSourceId]) return
    if (attempted.has(attemptKey)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    attempted.add(attemptKey)
    let cancelled = false
    const controller = new AbortController()
    // Taken before the first request: anything that comes back after the
    // source was removed or refreshed is dropped by the catalog.
    const tokens = Object.fromEntries(
      CATALOG_TYPES.map((type) => [type, catalog.beginGeneration(activeSourceId, type)])
    ) as Record<CatalogType, ReturnType<typeof catalog.beginGeneration>>
    const commitCategories = (type: CatalogType, categories: CatalogCategory[]) => {
      if (categories.length > 0) catalog.commit({ token: tokens[type], mode: 'partial', categories })
    }
    const commitPreview = (type: CatalogType, items: CatalogItem[]) => {
      if (items.length > 0) catalog.commit({ token: tokens[type], mode: 'partial', items })
    }

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
        commitCategories('live', xtreamCategoriesToRecords(liveCats, activeSourceId, 'live'))
        commitCategories('vod', xtreamCategoriesToRecords(vodCats, activeSourceId, 'vod'))
        commitCategories('series', xtreamCategoriesToRecords(seriesCats, activeSourceId, 'series'))

        // Step 2: Small preview for dashboard display (~150KB total, fast)
        setStage('preview')
        const [livePreview, vodPreview, seriesPreview] = await Promise.all([
          xtreamApi.getLivePreviewStreams(creds, 50, { signal: controller.signal }).catch(() => []),
          xtreamApi.getVodPreviewStreams(creds, 30, { signal: controller.signal }).catch(() => []),
          xtreamApi.getSeriesPreviewStreams(creds, 30, { signal: controller.signal }).catch(() => [])
        ])
        if (cancelled) return
        commitPreview('live', xtreamLiveToRecords(livePreview, activeSourceId))
        commitPreview('vod', xtreamVodToRecords(vodPreview, activeSourceId))
        commitPreview('series', xtreamSeriesToRecords(seriesPreview, activeSourceId))

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
    hasChannelsForSource,
    isSourceComplete,
    xtreamAuth,
    getXtreamCredentials,
    setPlaylistLoading,
    reloadToken
  ])

  const retry = () => {
    if (activeSourceId) {
      // Keeps what is on screen, cancels running syncs and marks the lists
      // incomplete; the new revision lets the bootstrap and the full sync run again.
      replaceSourceCatalog(activeSourceId, null)
    }
    setError(null)
    requestSourceReconnect()
    bumpReloadToken()
  }

  return { error, isBootstrapping, stage, retry }
}
