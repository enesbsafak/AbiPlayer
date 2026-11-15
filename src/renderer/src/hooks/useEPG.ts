import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '@/store'
import { epgWindow, normalizeEpgChannelKey } from '@/services/epg-service'
import { xtreamApi } from '@/services/xtream-api'
import { toUserMessage } from '@/services/user-error'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { sourceEpgUrl, subscribeSourceMeta } from '@/catalog/source-meta'
import { sourceIdentity } from '@/catalog/worker-ingest'
import { catalogWorker, type CatalogWorkerClient } from '@/workers/client'
import type { EpgResultMeta } from '@/workers/protocol'
import type { EPGChannel, EPGData, EPGProgram } from '@/types/epg'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'

const MIN_EPG_REFRESH_MINUTES = 5
const MAX_EPG_REFRESH_MINUTES = 1440

export function epgRefreshMs(minutes: number | undefined): number {
  return Math.min(MAX_EPG_REFRESH_MINUTES, Math.max(MIN_EPG_REFRESH_MINUTES, Math.floor(minutes || 60))) * 60_000
}

/** Where a source's guide comes from: the panel's XMLTV, or the playlist header's `url-tvg`. */
export function epgUrlFor(source: PlaylistSource): string | null {
  if (source.type === 'xtream') {
    if (!source.url || !source.username || !source.password) return null
    return xtreamApi.buildEpgUrl({ url: source.url, username: source.username, password: source.password })
  }
  return sourceEpgUrl(source.id)
}

export interface EpgLoaderDeps {
  worker?: () => CatalogWorkerClient
  catalog?: CatalogStore
  now?: () => number
}

interface Running {
  sourceId: string
  controller: AbortController
  promise: Promise<void>
}

/**
 * Loads guides through the catalog worker, one source at a time: starting a
 * load for another source cancels the one in flight (its download stops in
 * the worker), and a result is only applied while its source is still the
 * active one. The cached guide is shown first, then refreshed when stale.
 */
export function createEpgLoader(deps: EpgLoaderDeps = {}) {
  const worker = deps.worker ?? catalogWorker
  const store = deps.catalog ?? defaultCatalog
  const now = deps.now ?? Date.now
  let running: Running | null = null

  const assemble = (channels: EPGChannel[], programmes: Array<[string, EPGProgram[]]>, into: EPGData) => {
    for (const channel of channels) {
      const key = normalizeEpgChannelKey(channel.id)
      if (key) into.channels[key] = channel
    }
    for (const [key, list] of programmes) {
      if (normalizeEpgChannelKey(key) === key) into.programs[key] = list
    }
  }

  const emptyGuide = (): EPGData => ({
    // Null-prototype maps, as the parser makes them: ids are untrusted.
    channels: Object.create(null) as Record<string, EPGChannel>,
    programs: Object.create(null) as Record<string, EPGProgram[]>,
    lastUpdated: now()
  })

  const withMeta = (data: EPGData, meta: EpgResultMeta): EPGData => {
    data.lastUpdated = meta.fetchedAt
    if (meta.truncated) {
      data.truncated = true
      data.truncatedReason = meta.truncated === 'limit' ? 'limit' : 'cut-off'
    }
    return data
  }

  /** The keys of the source's live channels, when its list is complete; null keeps every channel. */
  const wantedKeys = (sourceId: string): string[] | null => {
    if (!store.getStatus(sourceId, 'live')?.complete) return null
    const keys = new Set<string>()
    for (const item of store.getItems(sourceId, 'live')) {
      const key = normalizeEpgChannelKey(item.epgChannelId)
      if (key) keys.add(key)
    }
    return keys.size > 0 ? [...keys] : null
  }

  async function load(sourceId: string, options: { force?: boolean } = {}): Promise<void> {
    if (running && running.sourceId === sourceId) {
      if (!options.force) return running.promise
      running.controller.abort()
    } else if (running) {
      // Another source: its guide no longer matters.
      running.controller.abort()
    }

    const controller = new AbortController()
    const signal = controller.signal
    const entry: Running = { sourceId, controller, promise: Promise.resolve() }
    running = entry
    const isCurrent = () => !signal.aborted && running === entry && useStore.getState().activeSourceId === sourceId

    entry.promise = (async () => {
      const state = useStore.getState()
      const source = state.sources.find((item) => item.id === sourceId)
      const identity = source ? sourceIdentity(source) : null
      const url = source ? epgUrlFor(source) : null
      if (!source || !identity) return

      state.beginEpgLoad()
      const window = epgWindow(now())
      const showsThisSource = state.epgSourceId === sourceId && !!state.epgData

      // The cached guide first, unless one for this source is already shown.
      if (!showsThisSource && !options.force) {
        const cached = emptyGuide()
        try {
          const result = await worker().run(
            { kind: 'epg-cache-read', sourceId, identity, ...window },
            { onEpgBatch: (channels, programmes) => assemble(channels, programmes, cached) },
            signal
          )
          if (result.kind === 'epg' && isCurrent()) {
            useStore.getState().completeEpgLoad(sourceId, withMeta(cached, result.meta), { fromCache: true, fetchedAt: result.meta.fetchedAt })
            const fresh = now() - result.meta.fetchedAt < epgRefreshMs(useStore.getState().settings.epgRefreshInterval)
            if (fresh) return
            useStore.getState().beginEpgLoad()
          }
        } catch {
          // No usable cache: download.
        }
      }

      if (!isCurrent()) return
      if (!url) {
        useStore.getState().failEpgLoad(source.type === 'xtream' ? strings.epg.addressFailed : strings.epg.noPlaylistGuide)
        return
      }
      const fresh = emptyGuide()
      try {
        const result = await worker().run(
          { kind: 'epg', sourceId, url, identity, revision: store.getSourceRevision(sourceId), ...window, channelKeys: wantedKeys(sourceId), cache: true },
          { onEpgBatch: (channels, programmes) => assemble(channels, programmes, fresh) },
          signal
        )
        if (result.kind !== 'epg' || !isCurrent()) return
        useStore.getState().completeEpgLoad(sourceId, withMeta(fresh, result.meta), { fromCache: false, fetchedAt: result.meta.fetchedAt })
      } catch (error) {
        if (!isCurrent()) return
        useStore.getState().failEpgLoad(toUserMessage(await certificateAwareError(error), strings.epg.loadFailed))
      }
    })()

    try {
      await entry.promise
    } finally {
      // A load another one replaced leaves the spinner to its successor.
      if (running === entry) {
        running = null
        if (useStore.getState().epgLoading) useStore.getState().setEpgLoading(false)
      }
    }
  }

  return {
    load,
    /** Stops the load in flight, if any. */
    cancel() {
      if (!running) return
      running.controller.abort()
      running = null
      useStore.getState().setEpgLoading(false)
    },
    get runningSourceId() {
      return running?.sourceId ?? null
    }
  }
}

const loader = createEpgLoader()

/** Loads (or with `force`, refreshes) the guide of a source; see `createEpgLoader`. */
export function loadEpg(sourceId: string, options?: { force?: boolean }): Promise<void> {
  return loader.load(sourceId, options)
}

function useSourceMetaVersion(): number {
  return useSyncExternalStore(subscribeSourceMeta, () => metaVersion)
}

let metaVersion = 0
subscribeSourceMeta(() => {
  metaVersion += 1
})

export function useEPG() {
  const location = useLocation()
  const activeSourceId = useStore((s) => s.activeSourceId)
  const epgSourceId = useStore((s) => s.epgSourceId)
  const epgData = useStore((s) => s.epgData)
  const epgLoading = useStore((s) => s.epgLoading)
  const epgLastFetched = useStore((s) => s.epgLastFetched)
  const epgRefreshInterval = useStore((s) => s.settings.epgRefreshInterval)
  const hasSource = useStore((s) => s.sources.some((source) => source.id === s.activeSourceId))
  // An M3U playlist's guide URL arrives with the playlist.
  const metaVersionValue = useSourceMetaVersion()
  const isEPGRoute = location.pathname.startsWith('/epg')

  useEffect(() => {
    if (!isEPGRoute || !activeSourceId || !hasSource) return
    const staleMs = epgRefreshMs(epgRefreshInterval)
    const hasCurrentSourceEpg = epgSourceId === activeSourceId
    const isStale = !hasCurrentSourceEpg || !epgData || !epgLastFetched || Date.now() - epgLastFetched > staleMs
    if (isStale) void loadEpg(activeSourceId)
  }, [isEPGRoute, activeSourceId, hasSource, epgSourceId, epgData, epgLastFetched, epgRefreshInterval, metaVersionValue])

  // Refresh while on the EPG route.
  useEffect(() => {
    if (!isEPGRoute || !activeSourceId) return
    const interval = setInterval(() => void loadEpg(activeSourceId, { force: true }), epgRefreshMs(epgRefreshInterval))
    return () => clearInterval(interval)
  }, [isEPGRoute, activeSourceId, epgRefreshInterval])

  return { epgData: activeSourceId && epgSourceId === activeSourceId ? epgData : null, epgLoading }
}
