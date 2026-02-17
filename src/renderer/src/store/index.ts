import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createSettingsSlice, type SettingsSlice } from './settings-slice'
import { createAuthSlice, type AuthSlice } from './auth-slice'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import { createEpgSlice, type EpgSlice } from './epg-slice'
import { createFavoritesSlice, type FavoritesSlice } from './favorites-slice'

export type AppStore = SettingsSlice & AuthSlice & PlaylistSlice & PlayerSlice & EpgSlice & FavoritesSlice

export const useStore = create<AppStore>()(
  persist(
    (...a) => ({
      ...createSettingsSlice(...a),
      ...createAuthSlice(...a),
      ...createPlaylistSlice(...a),
      ...createPlayerSlice(...a),
      ...createEpgSlice(...a),
      ...createFavoritesSlice(...a)
    }),
    {
      name: 'iptv-player-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        sources: state.sources,
        activeSourceId: state.activeSourceId,
        volume: state.volume,
        isMuted: state.isMuted,
        favoriteIds: Array.from(state.favoriteIds)
      }),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown>
        return {
          ...current,
          ...p,
          favoriteIds: new Set((p?.favoriteIds as string[]) || [])
        }
      }
    }
  )
)
