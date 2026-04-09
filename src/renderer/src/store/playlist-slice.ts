import type { StateCreator } from 'zustand'
import type { Channel, Category } from '@/types/playlist'

type ContentType = 'live' | 'vod' | 'series'

export interface SyncProgress {
  /** Which type is currently being synced */
  currentType: ContentType | null
  /** How many types completed out of 3 */
  completedTypes: number
  /** Is sync actively running */
  active: boolean
}

export interface PlaylistSlice {
  channels: Channel[]
  categories: Category[]
  /** Per-source, per-type hydration tracking: { [sourceId]: { live: true, vod: true } } */
  hydratedSourceTypes: Record<string, Partial<Record<ContentType, true>>>
  /** Legacy compat: true when ALL types for a source are hydrated */
  hydratedSourceIds: Record<string, true>
  syncProgress: Record<string, SyncProgress>
  syncErrors: Record<string, string>
  selectedCategoryId: string | null
  selectedChannelId: string | null
  channelFilter: ContentType
  isLoadingPlaylist: boolean
  setChannels: (channels: Channel[]) => void
  addChannels: (channels: Channel[]) => void
  removeChannelsBySource: (sourceId: string) => void
  setCategories: (categories: Category[]) => void
  addCategories: (categories: Category[]) => void
  removeCategoriesBySource: (sourceId: string) => void
  setSelectedCategory: (id: string | null) => void
  setSelectedChannel: (id: string | null) => void
  setChannelFilter: (filter: ContentType) => void
  markSourceTypeHydrated: (sourceId: string, type: ContentType) => void
  markSourceHydrated: (sourceId: string, hydrated?: boolean) => void
  isSourceTypeHydrated: (sourceId: string, type: ContentType) => boolean
  setSyncProgress: (sourceId: string, progress: SyncProgress | null) => void
  setSyncError: (sourceId: string, error: string | null) => void
  setPlaylistLoading: (loading: boolean) => void
  getFilteredChannels: () => Channel[]
  getChannelById: (id: string) => Channel | undefined
  getCategoriesByType: (type: ContentType) => Category[]
}

export const createPlaylistSlice: StateCreator<PlaylistSlice, [], [], PlaylistSlice> = (set, get) => ({
  channels: [],
  categories: [],
  hydratedSourceTypes: {},
  hydratedSourceIds: {},
  syncProgress: {},
  syncErrors: {},
  selectedCategoryId: null,
  selectedChannelId: null,
  channelFilter: 'live',
  isLoadingPlaylist: false,

  setChannels: (channels) => set({ channels }),
  addChannels: (channels) =>
    set((state) => {
      if (channels.length === 0) return state
      const existingIds = new Set(state.channels.map((c) => c.id))
      const newChannels = channels.filter((c) => !existingIds.has(c.id))
      if (newChannels.length === 0) return state
      return { channels: [...state.channels, ...newChannels] }
    }),
  removeChannelsBySource: (sourceId) =>
    set((state) => {
      const nextHydratedSourceTypes = { ...state.hydratedSourceTypes }
      delete nextHydratedSourceTypes[sourceId]
      const nextHydratedSourceIds = { ...state.hydratedSourceIds }
      delete nextHydratedSourceIds[sourceId]

      return {
        channels: state.channels.filter((c) => c.sourceId !== sourceId),
        hydratedSourceTypes: nextHydratedSourceTypes,
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
  setChannelFilter: (filter) =>
    set((state) => {
      if (state.channelFilter === filter) return state
      return { channelFilter: filter, selectedCategoryId: null }
    }),

  markSourceTypeHydrated: (sourceId, type) =>
    set((state) => {
      const sourceTypes = { ...state.hydratedSourceTypes[sourceId], [type]: true as const }
      const nextHydratedSourceTypes = { ...state.hydratedSourceTypes, [sourceId]: sourceTypes }
      // Update legacy flag: all 3 types hydrated = fully hydrated
      const allHydrated = sourceTypes.live && sourceTypes.vod && sourceTypes.series
      const nextHydratedSourceIds = { ...state.hydratedSourceIds }
      if (allHydrated) nextHydratedSourceIds[sourceId] = true
      return { hydratedSourceTypes: nextHydratedSourceTypes, hydratedSourceIds: nextHydratedSourceIds }
    }),

  markSourceHydrated: (sourceId, hydrated = true) =>
    set((state) => {
      const nextHydratedSourceIds = { ...state.hydratedSourceIds }
      const nextHydratedSourceTypes = { ...state.hydratedSourceTypes }
      if (hydrated) {
        nextHydratedSourceIds[sourceId] = true
        nextHydratedSourceTypes[sourceId] = { live: true, vod: true, series: true }
      } else {
        delete nextHydratedSourceIds[sourceId]
        delete nextHydratedSourceTypes[sourceId]
      }
      return { hydratedSourceIds: nextHydratedSourceIds, hydratedSourceTypes: nextHydratedSourceTypes }
    }),

  isSourceTypeHydrated: (sourceId, type) => {
    return !!get().hydratedSourceTypes[sourceId]?.[type]
  },

  setSyncProgress: (sourceId, progress) =>
    set((state) => {
      const next = { ...state.syncProgress }
      if (progress) {
        next[sourceId] = progress
      } else {
        delete next[sourceId]
      }
      return { syncProgress: next }
    }),

  setSyncError: (sourceId, error) =>
    set((state) => {
      const nextErrors = { ...state.syncErrors }
      if (error) {
        nextErrors[sourceId] = error
      } else {
        delete nextErrors[sourceId]
      }
      return { syncErrors: nextErrors }
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
