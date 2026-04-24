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
  clearEpg: () => set({ epgSourceId: null, epgData: null, epgLastFetched: null, epgError: null })
})
