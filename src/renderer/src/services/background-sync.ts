import { xtreamApi } from './xtream-api'
import { useStore } from '@/store'
import type { XtreamCredentials } from '@/types/xtream'

/**
 * Module-level background sync that persists across page navigation.
 * Once started, a sync completes even if the page that triggered it unmounts.
 */

type ContentType = 'live' | 'vod' | 'series'

const TYPE_LABELS: Record<ContentType, string> = {
  live: 'Canlı TV',
  vod: 'Filmler',
  series: 'Diziler'
}

const activeSyncs = new Map<string, Promise<void>>()

function syncKey(sourceId: string, type: ContentType): string {
  return `${sourceId}:${type}`
}

/**
 * Ensures a single content type is fully synced for a source.
 * Returns a promise that resolves when sync completes (or was already done).
 */
export function ensureFullSync(
  sourceId: string,
  type: ContentType,
  creds: XtreamCredentials
): Promise<void> {
  const key = syncKey(sourceId, type)
  const existing = activeSyncs.get(key)
  if (existing) return existing

  const { isSourceTypeHydrated, addChannels, markSourceTypeHydrated, setSyncError } = useStore.getState()
  if (isSourceTypeHydrated(sourceId, type)) return Promise.resolve()

  const promise = (async () => {
    try {
      if (type === 'live') {
        const streams = await xtreamApi.getLiveStreams(creds)
        addChannels(xtreamApi.liveStreamsToChannels(streams, creds, sourceId))
      } else if (type === 'vod') {
        const streams = await xtreamApi.getVodStreams(creds)
        addChannels(xtreamApi.vodStreamsToChannels(streams, creds, sourceId))
      } else {
        const streams = await xtreamApi.getSeries(creds)
        addChannels(xtreamApi.seriesToChannels(streams, sourceId))
      }
      markSourceTypeHydrated(sourceId, type)
      setSyncError(sourceId, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'İçerik senkronizasyonu başarısız'
      console.warn(`[background-sync] ${type} sync failed for ${sourceId}:`, message)
      setSyncError(sourceId, message)
    } finally {
      activeSyncs.delete(key)
    }
  })()

  activeSyncs.set(key, promise)
  return promise
}

/**
 * Staged prefetch: syncs the priority type first, then others sequentially.
 * Reports progress to store so UI can show percentage.
 */
export async function ensureStagedSync(
  sourceId: string,
  priorityType: ContentType,
  creds: XtreamCredentials
): Promise<void> {
  const { setSyncProgress } = useStore.getState()
  const order: ContentType[] = [priorityType, ...(['live', 'vod', 'series'] as const).filter((t) => t !== priorityType)]
  let completed = 0

  for (const type of order) {
    const alreadyDone = useStore.getState().isSourceTypeHydrated(sourceId, type)
    if (alreadyDone) {
      completed++
      continue
    }

    setSyncProgress(sourceId, {
      currentType: type,
      completedTypes: completed,
      active: true
    })

    await ensureFullSync(sourceId, type, creds)
    completed++

    setSyncProgress(sourceId, {
      currentType: null,
      completedTypes: completed,
      active: completed < 3
    })
  }

  setSyncProgress(sourceId, null)
}

/**
 * Ensures all content types for a source are fully synced.
 * Uses staged approach: live → vod → series (sequential, not parallel).
 */
export function ensureSourceFullSync(sourceId: string, creds: XtreamCredentials): void {
  void ensureStagedSync(sourceId, 'live', creds)
}

export { TYPE_LABELS }
