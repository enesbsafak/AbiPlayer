import type { StateCreator } from 'zustand'
import type { Channel, Category } from '@/types/playlist'

export interface PlaylistSlice {
  channels: Channel[]
  categories: Category[]
  hydratedSourceIds: Record<string, true>
  selectedCategoryId: string | null
  selectedChannelId: string | null
  channelFilter: 'live' | 'vod' | 'series'
  isLoadingPlaylist: boolean
  setChannels: (channels: Channel[]) => void
  addChannels: (channels: Channel[]) => void
  removeChannelsBySource: (sourceId: string) => void
  setCategories: (categories: Category[]) => void
  addCategories: (categories: Category[]) => void
  removeCategoriesBySource: (sourceId: string) => void
  setSelectedCategory: (id: string | null) => void
  setSelectedChannel: (id: string | null) => void
  setChannelFilter: (filter: 'live' | 'vod' | 'series') => void
  markSourceHydrated: (sourceId: string, hydrated?: boolean) => void
  setPlaylistLoading: (loading: boolean) => void
  getFilteredChannels: () => Channel[]
  getChannelById: (id: string) => Channel | undefined
  getCategoriesByType: (type: 'live' | 'vod' | 'series') => Category[]
}

export const createPlaylistSlice: StateCreator<PlaylistSlice, [], [], PlaylistSlice> = (set, get) => ({
  channels: [],
  categories: [],
  hydratedSourceIds: {},
  selectedCategoryId: null,
  selectedChannelId: null,
  channelFilter: 'live',
  isLoadingPlaylist: false,

  setChannels: (channels) => set({ channels }),
  addChannels: (channels) =>
    set((state) => {
      const existingIds = new Set(state.channels.map((c) => c.id))
      const newChannels = channels.filter((c) => !existingIds.has(c.id))
      if (newChannels.length === 0) return state
      return { channels: [...state.channels, ...newChannels] }
    }),
  removeChannelsBySource: (sourceId) =>
    set((state) => {
      const nextHydratedSourceIds = { ...state.hydratedSourceIds }
      delete nextHydratedSourceIds[sourceId]

      return {
        channels: state.channels.filter((c) => c.sourceId !== sourceId),
        hydratedSourceIds: nextHydratedSourceIds
      }
    }),

  setCategories: (categories) => set({ categories }),
  addCategories: (categories) =>
    set((state) => {
      const existingIds = new Set(state.categories.map((c) => c.id))
      const newCats = categories.filter((c) => !existingIds.has(c.id))
      if (newCats.length === 0) return state
      return { categories: [...state.categories, ...newCats] }
    }),
  removeCategoriesBySource: (sourceId) =>
    set((state) => ({ categories: state.categories.filter((c) => c.sourceId !== sourceId) })),

  setSelectedCategory: (id) => set({ selectedCategoryId: id }),
  setSelectedChannel: (id) => set({ selectedChannelId: id }),
  setChannelFilter: (filter) => set({ channelFilter: filter, selectedCategoryId: null }),
  markSourceHydrated: (sourceId, hydrated = true) =>
    set((state) => {
      const nextHydratedSourceIds = { ...state.hydratedSourceIds }
      if (hydrated) {
        nextHydratedSourceIds[sourceId] = true
      } else {
        delete nextHydratedSourceIds[sourceId]
      }
      return { hydratedSourceIds: nextHydratedSourceIds }
    }),
  setPlaylistLoading: (loading) => set({ isLoadingPlaylist: loading }),

  getFilteredChannels: () => {
    const { channels, selectedCategoryId, channelFilter } = get()
    let filtered = channels.filter((c) => c.type === channelFilter)
    if (selectedCategoryId) {
      filtered = filtered.filter((c) => c.categoryId === selectedCategoryId)
    }
    return filtered
  },

  getChannelById: (id) => get().channels.find((c) => c.id === id),

  getCategoriesByType: (type) => get().categories.filter((c) => c.type === type)
})
