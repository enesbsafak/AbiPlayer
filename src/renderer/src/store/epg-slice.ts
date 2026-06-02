import type { StateCreator } from 'zustand'
import type { EPGData } from '@/types/epg'

export interface EpgSlice {
  epgSourceId: string | null
  epgData: EPGData | null
  epgLoading: boolean
  epgError: string | null
  epgLastFetched: number | null
  setEpgData: (sourceId: string, data: EPGData) => void
  setEpgLoading: (loading: boolean) => void
  setEpgError: (error: string | null) => void
  beginEpgLoad: () => void
  completeEpgLoad: (sourceId: string, data: EPGData) => void
  failEpgLoad: (error: string) => void
  clearEpg: () => void
}

export const createEpgSlice: StateCreator<EpgSlice, [], [], EpgSlice> = (set) => ({
  epgSourceId: null,
  epgData: null,
  epgLoading: false,
  epgError: null,
  epgLastFetched: null,

  setEpgData: (sourceId, data) => set({ epgSourceId: sourceId, epgData: data, epgLastFetched: Date.now(), epgError: null }),
  setEpgLoading: (loading) => set({ epgLoading: loading }),
  setEpgError: (error) => set({ epgError: error }),
  beginEpgLoad: () => set({ epgLoading: true, epgError: null }),
  completeEpgLoad: (sourceId, data) =>
    set({ epgSourceId: sourceId, epgData: data, epgLastFetched: Date.now(), epgError: null, epgLoading: false }),
  failEpgLoad: (error) => set({ epgError: error, epgLoading: false }),
  clearEpg: () => set({ epgSourceId: null, epgData: null, epgLastFetched: null, epgError: null })
})
