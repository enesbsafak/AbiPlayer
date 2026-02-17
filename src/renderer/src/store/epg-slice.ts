import type { StateCreator } from 'zustand'
import type { EPGData } from '@/types/epg'

export interface EpgSlice {
  epgData: EPGData | null
  epgLoading: boolean
  epgError: string | null
  epgLastFetched: number | null
  setEpgData: (data: EPGData) => void
  setEpgLoading: (loading: boolean) => void
  setEpgError: (error: string | null) => void
  clearEpg: () => void
}

export const createEpgSlice: StateCreator<EpgSlice, [], [], EpgSlice> = (set) => ({
  epgData: null,
  epgLoading: false,
  epgError: null,
  epgLastFetched: null,

  setEpgData: (data) => set({ epgData: data, epgLastFetched: Date.now(), epgError: null }),
  setEpgLoading: (loading) => set({ epgLoading: loading }),
  setEpgError: (error) => set({ epgError: error }),
  clearEpg: () => set({ epgData: null, epgLastFetched: null, epgError: null })
})
