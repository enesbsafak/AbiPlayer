import { xtreamApi } from './xtream-api'
import { useStore } from '@/store'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { xtreamLiveToRecords, xtreamSeriesToRecords, xtreamVodToRecords } from '@/catalog/convert'
import { toCatalogSyncError } from '@/catalog/sync-error'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { ingestXtreamList } from '@/catalog/worker-ingest'
import type { CatalogItem, CatalogType, GenerationToken } from '@/catalog/types'
import type { CatalogWorkerClient } from '@/workers/client'
import type { XtreamCredentials } from '@/types/xtream'
import { perfMark } from './perf'

/**
 * Module-level background sync that persists across page navigation.
 * Once started, a sync completes even if the page that triggered it unmounts.
 *
 * Every full sync is one generation of its (source, type): the token is taken
 * before the request, the requests are aborted when the source is removed or
 * refreshed, and the result is committed as a complete list that replaces the
 * previous one. A result that comes back for a removed or refreshed source is
 * dropped by the catalog store.
 *
 * The download, parse and conversion run in the catalog worker, which also
 * writes the list to the disk cache; its batches are swapped in at once.
 */

type ContentType = CatalogType

/** Fetches one complete list and turns it into records (main-thread variant, for tests and tools). */
export type FullListFetcher = (
  type: ContentType,
  creds: XtreamCredentials,
  sourceId: string,
  signal: AbortSignal
) => Promise<CatalogItem[]>

export const fetchFullXtreamList: FullListFetcher = async (type, creds, sourceId, signal) => {
  if (type === 'live') return xtreamLiveToRecords(await xtreamApi.getLiveStreams(creds, undefined, { signal }), sourceId)
  if (type === 'vod') return xtreamVodToRecords(await xtreamApi.getVodStreams(creds, undefined, { signal }), sourceId)
  return xtreamSeriesToRecords(await xtreamApi.getSeries(creds, undefined, { signal }), sourceId)
}

export interface FullSyncOptions {
  /**
   * Download again even though a complete list is held. The list stays on
   * screen and is replaced once the fresh one is complete. A list served
   * from the disk cache is always refreshed.
   */
  refresh?: boolean
}

export interface BackgroundSync {
  ensureFullSync(sourceId: string, type: ContentType, creds: XtreamCredentials, options?: FullSyncOptions): Promise<void>
  ensureStagedSync(sourceId: string, priorityType: ContentType, creds: XtreamCredentials, options?: FullSyncOptions): Promise<void>
}

/** The held list is complete and fresh from the provider: nothing to sync. */
function isSettled(catalog: CatalogStore, sourceId: string, type: ContentType, options?: FullSyncOptions): boolean {
  const status = catalog.getStatus(sourceId, type)
  return !!status?.complete && !status.fromCache && !options?.refresh
}

/**
 * `fetchFullList` replaces the worker with a main-thread fetcher (tests);
 * `worker` picks the worker client (tests).
 */
export function createBackgroundSync(
  catalog: CatalogStore,
  fetchFullList?: FullListFetcher,
  worker?: () => CatalogWorkerClient
): BackgroundSync {
  // Keyed by revision too: after a refresh a new sync must not join the
  // cancelled one that is still unwinding.
  const activeSyncs = new Map<string, Promise<void>>()

  const runList = async (token: GenerationToken, creds: XtreamCredentials, signal: AbortSignal): Promise<number> => {
    if (fetchFullList) {
      const items = await fetchFullList(token.type, creds, token.sourceId, signal)
      catalog.commit({ token, mode: 'replace', items })
      return items.length
    }
    const outcome = await ingestXtreamList(
      { sourceId: token.sourceId, type: token.type, creds, token },
      { store: catalog, worker: worker?.(), signal }
    )
    return outcome.counts[token.type] ?? 0
  }

  const ensureFullSync: BackgroundSync['ensureFullSync'] = (sourceId, type, creds, options) => {
    const key = `${sourceId}:${type}:${catalog.getSourceRevision(sourceId)}`
    const existing = activeSyncs.get(key)
    if (existing) return existing
    if (isSettled(catalog, sourceId, type, options)) return Promise.resolve()

    const token = catalog.beginGeneration(sourceId, type)
    const signal = catalog.sourceSignal(sourceId)
    catalog.setSyncState(token, { syncing: true, error: null })

    const promise = (async () => {
      try {
        perfMark('sync:start', { type })
        const items = await runList(token, creds, signal)
        perfMark('sync:done', { type, items })
        catalog.setSyncState(token, { syncing: false, error: null })
      } catch (error) {
        perfMark('sync:failed', { type })
        const syncError = signal.aborted ? null : toCatalogSyncError(await certificateAwareError(error))
        if (syncError) console.warn(`[background-sync] ${type} sync failed for ${sourceId}:`, syncError.message)
        catalog.setSyncState(token, { syncing: false, error: syncError })
      } finally {
        activeSyncs.delete(key)
      }
    })()

    activeSyncs.set(key, promise)
    return promise
  }

  /**
   * Staged prefetch: syncs the priority type first, then the others in
   * parallel. Reports progress to the store so the UI can show it; progress of
   * a source removed or refreshed meanwhile is not written back.
   */
  const ensureStagedSync: BackgroundSync['ensureStagedSync'] = async (sourceId, priorityType, creds, options) => {
    const revision = catalog.getSourceRevision(sourceId)
    const isCurrent = () => catalog.getSourceRevision(sourceId) === revision
    const { setSyncProgress } = useStore.getState()
    const order: ContentType[] = [priorityType, ...(['live', 'vod', 'series'] as const).filter((t) => t !== priorityType)]
    let completed = 0
    const pendingTypes: ContentType[] = []

    for (const type of order) {
      if (isSettled(catalog, sourceId, type, options)) {
        completed++
        continue
      }
      pendingTypes.push(type)
    }

    const [firstType, ...remainingTypes] = pendingTypes

    if (firstType) {
      setSyncProgress(sourceId, { currentType: firstType, completedTypes: completed, active: true })

      await ensureFullSync(sourceId, firstType, creds, options)
      completed++

      // Removed or refreshed meanwhile: the rest would sync a source that is
      // gone, or one whose new revision starts its own syncs.
      if (!isCurrent()) {
        setSyncProgress(sourceId, null)
        return
      }
      setSyncProgress(sourceId, {
        currentType: null,
        completedTypes: completed,
        active: completed < 3 && remainingTypes.length > 0
      })
    }

    await Promise.all(
      remainingTypes.map(async (type) => {
        await ensureFullSync(sourceId, type, creds, options)
        completed++
        if (!isCurrent()) return
        setSyncProgress(sourceId, { currentType: null, completedTypes: completed, active: completed < 3 })
      })
    )

    setSyncProgress(sourceId, null)
  }

  return { ensureFullSync, ensureStagedSync }
}

const backgroundSync = createBackgroundSync(defaultCatalog)

/**
 * Ensures a single content type is fully synced for a source.
 * Returns a promise that resolves when sync completes (or was already done).
 */
export const ensureFullSync = backgroundSync.ensureFullSync

export const ensureStagedSync = backgroundSync.ensureStagedSync
