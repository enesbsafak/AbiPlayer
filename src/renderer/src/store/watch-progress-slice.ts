import type { StateCreator } from 'zustand'
import type { Channel } from '@/types/playlist'
import {
  isCompleted,
  isTrackableChannel,
  progressKeyFor,
  removeProgress,
  shouldStoreProgress,
  toProgressChannel,
  upsertProgress,
  type WatchProgressEntry
} from '@/services/watch-progress'

export interface WatchProgressSlice {
  watchProgress: WatchProgressEntry[]
  saveWatchProgress: (channel: Channel, position: number, duration: number) => void
  removeWatchProgress: (key: string) => void
  clearWatchProgress: () => void
}

export const createWatchProgressSlice: StateCreator<
  WatchProgressSlice,
  [],
  [],
  WatchProgressSlice
> = (set) => ({
  watchProgress: [],

  saveWatchProgress: (channel, position, duration) =>
    set((state) => {
      const key = isTrackableChannel(channel) ? progressKeyFor(channel) : null
      if (!key) return state

      if (!shouldStoreProgress(position, duration)) {
        // Reaching the end is what retires an entry; anything else (a few
        // seconds in, duration not known yet) leaves the stored position alone.
        if (isCompleted(position, duration)) {
          return { watchProgress: removeProgress(state.watchProgress, key) }
        }
        return state
      }

      return {
        watchProgress: upsertProgress(state.watchProgress, {
          key,
          channel: toProgressChannel(channel),
          position,
          duration,
          updatedAt: Date.now()
        })
      }
    }),

  removeWatchProgress: (key) =>
    set((state) => ({ watchProgress: removeProgress(state.watchProgress, key) })),

  clearWatchProgress: () => set({ watchProgress: [] })
})
