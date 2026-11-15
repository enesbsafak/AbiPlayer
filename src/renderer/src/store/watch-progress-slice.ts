import type { StateCreator } from 'zustand'
import {
  planProgressUpdate,
  removeProgress,
  upsertProgress,
  type ProgressSubject,
  type WatchProgressEntry
} from '@/services/watch-progress'

export interface WatchProgressSlice {
  watchProgress: WatchProgressEntry[]
  /** Records `position` for the item `subject` plays; live is never recorded. */
  saveWatchProgress: (subject: ProgressSubject, position: number, duration: number) => void
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

  saveWatchProgress: (subject, position, duration) =>
    set((state) => {
      const update = planProgressUpdate(subject, position, duration)
      switch (update.kind) {
        case 'none':
          return state
        case 'remove': {
          const next = update.keys.reduce(removeProgress, state.watchProgress)
          return next.length === state.watchProgress.length ? state : { watchProgress: next }
        }
        case 'upsert':
          // Saving under the media key also retires a legacy entry for the
          // same item, so it does not linger as a duplicate.
          return {
            watchProgress: upsertProgress(state.watchProgress, update.entry, update.replacesKey)
          }
      }
    }),

  removeWatchProgress: (key) =>
    set((state) => ({ watchProgress: removeProgress(state.watchProgress, key) })),

  clearWatchProgress: () => set({ watchProgress: [] })
})
