import { useSyncExternalStore } from 'react'
import { useStore } from '@/store'
import { getCatalogCacheKey, readPickedFile } from '@/services/platform'
import { ensureStagedSync } from '@/services/background-sync'
import { secureCredentialService } from '@/services/secure-credentials'
import { catalogWorker, type CatalogWorkerClient } from '@/workers/client'
import type { PlaylistSource } from '@/types/playlist'
import { catalog, type CatalogStore } from './catalog-store'
import { forgetSourceMeta } from './source-meta'
import { setCacheKeyPending } from './cache-key'
import { CATALOG_TYPES } from './types'
import { ingestDropped, ingestFromCache, ingestM3uText, ingestM3uUrl, sourceIdentity, type IngestOutcome } from './worker-ingest'

/*
 * The disk cache's place in the app's life:
 *
 * - Once the stored secrets are loaded, the cache key goes to the worker,
 *   data of sources that no longer exist is collected, and each source's
 *   cached catalog is shown at once (stale-while-revalidate): every M3U
 *   source (all of them connect at start) and the active Xtream source; other
 *   Xtream sources when they become active. Xtream lists read from the cache
 *   are refreshed from the provider in the background right away; M3U
 *   sources are refreshed by their normal connection at start.
 * - A removed source is dropped from disk (and late writes for it are
 *   refused); with no source left the database is emptied.
 * - Lists older than `catalogMaxAgeMs` are refreshed while the app is open.
 * - The cache key lives in the encrypted credential file. When that file
 *   could not be read at start (no key then) or was lost and replaced (a new
 *   key: what the old one sealed is unreadable and dropped on read), the key
 *   is fetched again. A source whose secret arrives later (the store was read
 *   again, or the user entered the secret again) has its cache read then.
 */

/** Complete lists older than this are refreshed while the app runs. */
export const DEFAULT_CATALOG_MAX_AGE_MS = 12 * 60 * 60_000
const AGE_CHECK_INTERVAL_MS = 10 * 60_000
/** A cache read that has not finished by then no longer holds the home page back. */
const CACHE_SETTLE_TIMEOUT_MS = 3_000

let catalogMaxAgeMs = DEFAULT_CATALOG_MAX_AGE_MS

/** How old a complete list may get before it is refreshed in the background. */
export function setCatalogMaxAge(ms: number): void {
  catalogMaxAgeMs = Math.max(60_000, ms)
}

type LoadState = 'loading' | 'settled'
const loadStates = new Map<string, LoadState>()
const loadListeners = new Set<() => void>()
let watching = false
let started = false
let ageTimer: ReturnType<typeof setInterval> | null = null

function setLoadState(sourceId: string, state: LoadState | null): void {
  if ((loadStates.get(sourceId) ?? null) === state) return
  if (state) loadStates.set(sourceId, state)
  else loadStates.delete(sourceId)
  for (const listener of [...loadListeners]) listener()
}

/**
 * False while the cached catalog of the source is being read, so the home
 * page does not request a preview it is about to get from disk.
 */
export function isCatalogCacheSettled(sourceId: string | null): boolean {
  return !sourceId || loadStates.get(sourceId) !== 'loading'
}

export function useCatalogCacheSettled(sourceId: string | null): boolean {
  return useSyncExternalStore(
    (listener) => {
      loadListeners.add(listener)
      return () => loadListeners.delete(listener)
    },
    () => isCatalogCacheSettled(sourceId)
  )
}

function worker(): CatalogWorkerClient {
  return catalogWorker()
}

async function loadSourceCache(source: PlaylistSource, store: CatalogStore = catalog): Promise<IngestOutcome | null> {
  if (loadStates.has(source.id)) return null
  // Only types that hold no complete list yet.
  const types = CATALOG_TYPES.filter((type) => !store.getStatus(source.id, type)?.complete)
  if (types.length === 0) return null
  setLoadState(source.id, 'loading')
  const timeout = setTimeout(() => setLoadState(source.id, 'settled'), CACHE_SETTLE_TIMEOUT_MS)
  try {
    const outcome = await ingestFromCache(source, source.type === 'xtream' ? types : CATALOG_TYPES, { store })
    if (outcome && source.type === 'xtream' && Object.values(outcome.results).includes('committed')) revalidate(source.id)
    return outcome
  } catch (error) {
    console.warn('[catalog-cache] reading the cache failed:', error instanceof Error ? error.message : error)
    return null
  } finally {
    clearTimeout(timeout)
    setLoadState(source.id, 'settled')
  }
}

/** Background refresh of an Xtream source whose lists came from the cache. */
function revalidate(sourceId: string): void {
  const creds = useStore.getState().getXtreamCredentials(sourceId)
  if (!creds) return
  void ensureStagedSync(sourceId, 'live', creds)
}

/** Asks main for the M3U cache key and hands it to the worker; sealed jobs wait for it. */
function handOverCacheKey(client: CatalogWorkerClient): Promise<void> {
  const keyHandedOver = (async () => {
    let key: ArrayBuffer | null = null
    try {
      key = await getCatalogCacheKey()
    } catch (error) {
      console.warn('[catalog-cache] no cache key; M3U lists are not cached:', error instanceof Error ? error.message : error)
    }
    client.setKey(key)
  })()
  setCacheKeyPending(keyHandedOver)
  return keyHandedOver
}

/**
 * Fetches the cache key again: once the secure store can be read after all,
 * or after its file was lost (main then makes a new key). Called before the
 * secrets that need it are applied, so the cache jobs they start wait for it.
 */
export function refreshCatalogCacheKey(): Promise<void> {
  if (!started) return Promise.resolve()
  return handOverCacheKey(worker())
}

function start(): void {
  if (started) return
  started = true
  const { sources, activeSourceId } = useStore.getState()
  const client = worker()

  // Mark first, synchronously: the home page must not start a preview for a
  // source whose cache is about to be read.
  const toLoad = sources.filter((source) => source.type !== 'xtream' || source.id === activeSourceId)
  for (const source of toLoad) if (sourceIdentity(source)) setLoadState(source.id, 'loading')

  const keyHandedOver = handOverCacheKey(client)
  secureCredentialService.onLost(() => void refreshCatalogCacheKey())

  // Best effort: without it the browser may evict the cache under storage pressure.
  void Promise.resolve(navigator.storage?.persist?.()).catch(() => undefined)

  const load = (source: PlaylistSource) => {
    loadStates.delete(source.id)
    const latest = useStore.getState().sources.find((item) => item.id === source.id)
    if (latest) void loadSourceCache(latest)
    else setLoadState(source.id, null)
  }
  // Xtream lists are not sealed: read at once. M3U lists need the key.
  for (const source of toLoad) if (source.type === 'xtream') load(source)
  void keyHandedOver.then(() => {
    void client.run({ kind: 'cache-retain', sourceIds: useStore.getState().sources.map((source) => source.id) }).catch(() => undefined)
    for (const source of toLoad) if (source.type !== 'xtream') load(source)
  })

  ageTimer ??= setInterval(refreshOldLists, AGE_CHECK_INTERVAL_MS)
}

function refreshOldLists(): void {
  const now = Date.now()
  const state = useStore.getState()
  for (const source of state.sources) {
    const statuses = CATALOG_TYPES.map((type) => catalog.getStatus(source.id, type))
    const old = statuses.some((status) => status?.complete && !status.syncing && status.fetchedAt && now - status.fetchedAt > catalogMaxAgeMs)
    if (!old) continue
    if (source.type === 'xtream') {
      const creds = state.getXtreamCredentials(source.id)
      if (creds) void ensureStagedSync(source.id, 'live', creds, { refresh: true })
    } else {
      void reloadSourceCatalog(source.id).catch(() => undefined)
    }
  }
}

/**
 * Starts following the app: called by the auto-connect hook on its first
 * render, so the cache read starts the moment the secrets are in, before any
 * page effect asks the provider for a preview.
 */
export function watchCatalogCache(): void {
  if (watching) return
  watching = true
  if (useStore.getState().credentialsHydrated) start()

  useStore.subscribe((state, previous) => {
    if (state.credentialsHydrated && !previous.credentialsHydrated) start()
    if (!started) return

    if (state.sources !== previous.sources) {
      const remaining = new Set(state.sources.map((source) => source.id))
      for (const source of previous.sources) {
        if (remaining.has(source.id)) continue
        loadStates.delete(source.id)
        forgetSourceMeta(source.id)
        // Writes fetched at this revision or before are refused from now on.
        void worker()
          .run({ kind: 'cache-drop', sourceId: source.id, revision: catalog.getSourceRevision(source.id) })
          .catch(() => undefined)
      }
      // The last source gone: no catalog data stays on disk.
      if (state.sources.length === 0 && previous.sources.length > 0) {
        void worker().run({ kind: 'cache-retain', sourceIds: [] }).catch(() => undefined)
      }
      // A secret that arrived late (the store was read again, or the user
      // entered it): the source's cache can be told apart now. Not on the
      // first hydration: `start` reads those caches itself.
      const before = new Map(previous.sources.map((source) => [source.id, source]))
      for (const source of previous.credentialsHydrated ? state.sources : []) {
        const earlier = before.get(source.id)
        if (!earlier || sourceIdentity(earlier) || !sourceIdentity(source)) continue
        if (source.type === 'xtream' && source.id !== state.activeSourceId) continue
        loadStates.delete(source.id)
        void loadSourceCache(source)
      }
    }

    if (state.activeSourceId !== previous.activeSourceId && state.activeSourceId) {
      const source = state.sources.find((item) => item.id === state.activeSourceId)
      if (source?.type === 'xtream') void loadSourceCache(source)
    }
  })
}

/**
 * Reloads a source's catalog from the provider, keeping what is shown until
 * the fresh lists are complete: Xtream lists are downloaded again, an M3U
 * playlist is fetched (or its file read) again. For the certificate-trust
 * flow and the catalog banners. Rejects with a user-facing error.
 */
export async function reloadSourceCatalog(sourceId: string, options: { onlyStale?: boolean } = {}): Promise<void> {
  const state = useStore.getState()
  const source = state.sources.find((item) => item.id === sourceId)
  if (!source) return
  if (source.type === 'xtream') {
    const creds = state.getXtreamCredentials(sourceId)
    if (!creds) throw new Error('Kayıtlı kimlik bilgileri bulunamadı.')
    // `onlyStale`: lists that are complete and fresh from the provider stay.
    await ensureStagedSync(sourceId, 'live', creds, { refresh: !options.onlyStale })
    return
  }
  let outcome: IngestOutcome
  if (source.type === 'm3u_url') {
    if (!source.url) throw new Error('Kayıtlı liste adresi bulunamadı.')
    outcome = await ingestM3uUrl(sourceId, source.url)
  } else {
    if (!source.filePath) throw new Error('Liste dosyasının yolu kayıtlı değil. Dosyayı yeniden seçin.')
    const file = await readPickedFile(source.filePath)
    if (!file) return
    outcome = await ingestM3uText(sourceId, file.content, file.path)
  }
  // Refreshed again meanwhile: what this load fetched was not kept.
  if (ingestDropped(outcome) && useStore.getState().sources.some((item) => item.id === sourceId)) {
    throw new Error('Liste yüklenirken kaynak yeniden yüklendi. Tekrar deneyin.')
  }
  useStore.getState().setSourceError(sourceId, null)
}

/**
 * Drops what was loaded for a source that never made it into the source
 * list (an import that failed after the playlist was in): its lists in
 * memory and on disk.
 */
export function discardSourceCatalog(sourceId: string): void {
  catalog.removeSource(sourceId)
  forgetSourceMeta(sourceId)
  // Writes fetched at this revision or before (the import's) are refused.
  void worker().run({ kind: 'cache-drop', sourceId, revision: catalog.getSourceRevision(sourceId) }).catch(() => undefined)
}

/**
 * After the user trusted a certificate for a source: reloads what the
 * reconnect alone does not retry. Every Xtream source (its sign-in may have
 * worked while a list failed) fetches the lists that are not fresh; a
 * connected M3U source loads its playlist again. An M3U source that is not
 * connected yet is loaded by the reconnect itself.
 */
export function reloadAfterCertificateTrust(sourceId: string): Promise<void> {
  const source = useStore.getState().sources.find((item) => item.id === sourceId)
  if (!source) return Promise.resolve()
  if (source.type !== 'xtream') {
    const connected = CATALOG_TYPES.some((type) => {
      const status = catalog.getStatus(sourceId, type)
      return !!status?.loaded && !status.fromCache
    })
    if (!connected) return Promise.resolve()
  }
  return reloadSourceCatalog(sourceId, { onlyStale: source.type === 'xtream' })
}

/** Tests: forget every state of this module. */
export function resetCatalogCacheForTests(): void {
  loadStates.clear()
  started = false
  if (ageTimer) clearInterval(ageTimer)
  ageTimer = null
}
