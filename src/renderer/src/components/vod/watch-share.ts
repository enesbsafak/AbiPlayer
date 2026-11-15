import { useStore } from '@/store'
import type { WatchProgressEntry } from '@/services/watch-progress'
import type { Channel } from '@/types/playlist'
import { mediaKey, targetFromCatalogItem } from '../../../../shared/playback'

export interface WatchShare {
  /** Share watched, 0–100. */
  percent: number
  /** Whole minutes left. */
  minutesLeft: number
}

/** How far an entry of the watch history got, or null without one. */
export function watchShareOf(entry: WatchProgressEntry | null | undefined): WatchShare | null {
  if (!entry || entry.duration <= 0) return null
  return {
    percent: Math.min(100, Math.max(0, Math.round((entry.position / entry.duration) * 100))),
    minutesLeft: Math.max(0, Math.round((entry.duration - entry.position) / 60))
  }
}

/** The history entry of a film (or any playable list item), by its media key. */
export function useItemProgress(item: Channel): WatchProgressEntry | null {
  const target = targetFromCatalogItem(item)
  const key = target ? mediaKey(target) : null
  return useStore((s) => (key ? (s.watchProgress.find((entry) => entry.key === key) ?? null) : null))
}

/** The media key of an Xtream episode, as the watch history keys it. */
export function episodeKey(sourceId: string, episodeId: number): string {
  return mediaKey({ kind: 'episode', sourceId, streamId: episodeId, containerExtension: 'mp4', seriesId: null, season: null, episode: null })
}
