import type { StateCreator } from 'zustand'

export interface FavoritesSlice {
  favoriteIds: Set<string>
  toggleFavorite: (channelId: string) => void
  isFavorite: (channelId: string) => boolean
  setFavorites: (ids: string[]) => void
}

export const createFavoritesSlice: StateCreator<FavoritesSlice, [], [], FavoritesSlice> = (set, get) => ({
  favoriteIds: new Set<string>(),

  toggleFavorite: (channelId) =>
    set((state) => {
      const next = new Set(state.favoriteIds)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return { favoriteIds: next }
    }),

  isFavorite: (channelId) => get().favoriteIds.has(channelId),

  setFavorites: (ids) => set({ favoriteIds: new Set(ids) })
})
