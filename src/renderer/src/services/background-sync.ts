import { xtreamApi } from './xtream-api'
import { useStore } from '@/store'
import type { XtreamCredentials } from '@/types/xtream'

/**
 * Module-level background sync that persists across page navigation.
 * Once started, a sync completes even if the page that triggered it unmounts.
 */

const activeSyncs = new Map<string, Promise<void>>()

function syncKey(sourceId: string, type: 'live' | 'vod' | 'series'): string {
  return `${sourceId}:${type}`
}

export function isBackgroundSyncing(sourceId: string, type: 'live' | 'vod' | 'series'): boolean {
  return activeSyncs.has(syncKey(sourceId, type))
}

export function ensureFullSync(
  sourceId: string,
  type: 'live' | 'vod' | 'series',
  creds: XtreamCredentials
): void {
  const key = syncKey(sourceId, type)
  if (activeSyncs.has(key)) return

  const { hydratedSourceIds, addChannels, markSourceHydrated } = useStore.getState()
  if (hydratedSourceIds[sourceId]) return

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
    } catch {
      // Silently fail — pages will retry on next mount
    } finally {
      activeSyncs.delete(key)
    }
  })()

  activeSyncs.set(key, promise)
}

/**
 * Ensures all content types for a source are fully synced.
 * Safe to call repeatedly — deduplicates automatically.
 */
export function ensureSourceFullSync(sourceId: string, creds: XtreamCredentials): void {
  ensureFullSync(sourceId, 'live', creds)
  ensureFullSync(sourceId, 'vod', creds)
  ensureFullSync(sourceId, 'series', creds)
}
