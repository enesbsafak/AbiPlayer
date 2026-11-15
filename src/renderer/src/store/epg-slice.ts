import type { StateCreator } from 'zustand'
import type { EPGData } from '@/types/epg'

export interface EpgLoadMeta {
  /** The guide shown was read from the disk cache. */
  fromCache?: boolean
  /** When the provider sent it (epoch ms); defaults to now. */
  fetchedAt?: number
}

export interface EpgSlice {
  epgSourceId: string | null
  epgData: EPGData | null
  epgLoading: boolean
  epgError: string | null
  epgLastFetched: number | null
  /** The guide shown came from the disk cache and has not been refreshed yet. */
  epgFromCache: boolean
  setEpgLoading: (loading: boolean) => void
  beginEpgLoad: () => void
  completeEpgLoad: (sourceId: string, data: EPGData, meta?: EpgLoadMeta) => void
  failEpgLoad: (error: string) => void
  clearEpg: () => void
}

export const createEpgSlice: StateCreator<EpgSlice, [], [], EpgSlice> = (set) => ({
  epgSourceId: null,
  epgData: null,
  epgLoading: false,
  epgError: null,
  epgLastFetched: null,
  epgFromCache: false,

  setEpgLoading: (loading) => set({ epgLoading: loading }),
  beginEpgLoad: () => set({ epgLoading: true, epgError: null }),
  completeEpgLoad: (sourceId, data, meta = {}) =>
    set({
      epgSourceId: sourceId,
      epgData: data,
      epgLastFetched: meta.fetchedAt ?? Date.now(),
      epgError: null,
      epgLoading: false,
      epgFromCache: meta.fromCache === true
    }),
  failEpgLoad: (error) => set({ epgError: error, epgLoading: false }),
  clearEpg: () =>
    set({ epgSourceId: null, epgData: null, epgLastFetched: null, epgError: null, epgFromCache: false, epgLoading: false })
})
