import { xtreamApi } from './xtream-api'
import { useStore } from '@/store'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { xtreamLiveToRecords, xtreamSeriesToRecords, xtreamVodToRecords } from '@/catalog/convert'
import { toCatalogSyncError } from '@/catalog/sync-error'
import type { CatalogItem, CatalogType } from '@/catalog/types'
import type { XtreamCredentials } from '@/types/xtream'

/**
 * Module-level background sync that persists across page navigation.
 * Once started, a sync completes even if the page that triggered it unmounts.
 *
 * Every full sync is one generation of its (source, type): the token is taken
 * before the request, the requests are aborted when the source is removed or
 * refreshed, and the result is committed as a complete list that replaces the
 * previous one. A result that comes back for a removed or refreshed source is
 * dropped by the catalog store.
 */

type ContentType = CatalogType

/** Fetches one complete list and turns it into records. */
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

export interface BackgroundSync {
  ensureFullSync(sourceId: string, type: ContentType, creds: XtreamCredentials): Promise<void>
  ensureStagedSync(sourceId: string, priorityType: ContentType, creds: XtreamCredentials): Promise<void>
}

export function createBackgroundSync(
  catalog: CatalogStore,
  fetchFullList: FullListFetcher = fetchFullXtreamList
): BackgroundSync {
  // Keyed by revision too: after a refresh a new sync must not join the
  // cancelled one that is still unwinding.
  const activeSyncs = new Map<string, Promise<void>>()

  const ensureFullSync: BackgroundSync['ensureFullSync'] = (sourceId, type, creds) => {
    const key = `${sourceId}:${type}:${catalog.getSourceRevision(sourceId)}`
    const existing = activeSyncs.get(key)
    if (existing) return existing
    if (catalog.getStatus(sourceId, type)?.complete) return Promise.resolve()

    const token = catalog.beginGeneration(sourceId, type)
    const signal = catalog.sourceSignal(sourceId)
    catalog.setSyncState(token, { syncing: true, error: null })

    const promise = (async () => {
      try {
        const items = await fetchFullList(type, creds, sourceId, signal)
        catalog.commit({ token, mode: 'replace', items })
        catalog.setSyncState(token, { syncing: false, error: null })
      } catch (error) {
        const syncError = signal.aborted ? null : toCatalogSyncError(error)
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
  const ensureStagedSync: BackgroundSync['ensureStagedSync'] = async (sourceId, priorityType, creds) => {
    const revision = catalog.getSourceRevision(sourceId)
    const isCurrent = () => catalog.getSourceRevision(sourceId) === revision
    const { setSyncProgress } = useStore.getState()
    const order: ContentType[] = [priorityType, ...(['live', 'vod', 'series'] as const).filter((t) => t !== priorityType)]
    let completed = 0
    const pendingTypes: ContentType[] = []

    for (const type of order) {
      if (catalog.getStatus(sourceId, type)?.complete) {
        completed++
        continue
      }
      pendingTypes.push(type)
    }

    const [firstType, ...remainingTypes] = pendingTypes

    if (firstType) {
      setSyncProgress(sourceId, { currentType: firstType, completedTypes: completed, active: true })

      await ensureFullSync(sourceId, firstType, creds)
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
        await ensureFullSync(sourceId, type, creds)
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
