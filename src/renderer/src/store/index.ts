import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createSettingsSlice, type SettingsSlice } from './settings-slice'
import { createAuthSlice, type AuthSlice } from './auth-slice'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import { createEpgSlice, type EpgSlice } from './epg-slice'
import { createFavoritesSlice, type FavoritesSlice } from './favorites-slice'
import type { PlaylistSource } from '@/types/playlist'

export type AppStore = SettingsSlice & AuthSlice & PlaylistSlice & PlayerSlice & EpgSlice & FavoritesSlice

function isPersistedSource(source: unknown): source is PlaylistSource {
  if (!source || typeof source !== 'object') return false
  const s = source as PlaylistSource
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.type === 'string' &&
    typeof s.addedAt === 'number'
  )
}

function sanitizePersistedSources(input: unknown, fallback: PlaylistSource[]): PlaylistSource[] {
  if (!Array.isArray(input)) return fallback

  return input.filter(isPersistedSource)
}

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
        sources: state.sources.map((source) => {
          if (source.type !== 'xtream') return source
          const { username: _username, password: _password, ...safeSource } = source
          return safeSource
        }),
        activeSourceId: state.activeSourceId,
        volume: state.volume,
        isMuted: state.isMuted,
        favoriteIds: Array.from(state.favoriteIds)
      }),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown>
        const persistedSources = sanitizePersistedSources(p?.sources, current.sources)
        const persistedSettings =
          p?.settings && typeof p.settings === 'object'
            ? (p.settings as Partial<AppStore['settings']>)
            : {}

        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...persistedSettings },
          sources: persistedSources,
          favoriteIds: new Set((p?.favoriteIds as string[]) || [])
        }
      }
    }
  )
)
