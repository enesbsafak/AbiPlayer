import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { createSettingsSlice, type SettingsSlice } from './settings-slice'
import { createAuthSlice, type AuthSlice } from './auth-slice'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import { createEpgSlice, type EpgSlice } from './epg-slice'
import { createFavoritesSlice, type FavoritesSlice } from './favorites-slice'
import { createNavigationSlice, type NavigationSlice } from './navigation-slice'
import type { PlaylistSource } from '@/types/playlist'

export type AppStore =
  & SettingsSlice
  & AuthSlice
  & PlaylistSlice
  & PlayerSlice
  & EpgSlice
  & FavoritesSlice
  & NavigationSlice

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

function safeLocalGet(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch (err) {
    console.warn('[store] localStorage.getItem failed:', err)
    return null
  }
}

function safeLocalSet(name: string, value: string): void {
  try {
    localStorage.setItem(name, value)
  } catch (err) {
    // QuotaExceededError, SecurityError, etc. — don't crash the app.
    console.warn('[store] localStorage.setItem failed (possibly quota):', err)
  }
}

function safeLocalRemove(name: string): void {
  try {
    localStorage.removeItem(name)
  } catch (err) {
    console.warn('[store] localStorage.removeItem failed:', err)
  }
}

function createBackupFallbackStorage(): StateStorage {
  return {
    getItem(name: string): string | null | Promise<string | null> {
      const local = safeLocalGet(name)
      if (local) return local

      if (!window.electron?.getStoreBackup) return null

      return (async () => {
        try {
          const backup = await window.electron!.getStoreBackup()
          if (backup) {
            safeLocalSet(name, backup)
            void window.electron!.deleteStoreBackup?.()
            return backup
          }
        } catch { /* ignore */ }
        return null
      })()
    },
    setItem(name: string, value: string): void {
      safeLocalSet(name, value)
    },
    removeItem(name: string): void {
      safeLocalRemove(name)
    }
  }
}

export const useStore = create<AppStore>()(
  persist(
    (...a) => ({
      ...createSettingsSlice(...a),
      ...createAuthSlice(...a),
      ...createPlaylistSlice(...a),
      ...createPlayerSlice(...a),
      ...createEpgSlice(...a),
      ...createFavoritesSlice(...a),
      ...createNavigationSlice(...a)
    }),
    {
      name: 'iptv-player-store',
      storage: createJSONStorage(createBackupFallbackStorage),
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
        // Only accept known keys from persisted state. Spreading raw `persisted` can
        // inject arbitrary keys (volatile state, prototype fields) if the payload is
        // tampered with. Keep this in sync with `partialize` above.
        const p = (persisted && typeof persisted === 'object'
          ? (persisted as Record<string, unknown>)
          : {}) as Record<string, unknown>

        const persistedSources = sanitizePersistedSources(p.sources, current.sources)
        const persistedSettings =
          p.settings && typeof p.settings === 'object'
            ? (p.settings as Partial<AppStore['settings']>)
            : {}

        const rawFavoriteIds = Array.isArray(p.favoriteIds) ? p.favoriteIds : []
        const favoriteIds = new Set<string>()
        for (const item of rawFavoriteIds) {
          if (typeof item === 'string') favoriteIds.add(item)
        }

        const volume =
          typeof p.volume === 'number' && Number.isFinite(p.volume)
            ? Math.max(0, Math.min(1, p.volume))
            : current.volume
        const isMuted = typeof p.isMuted === 'boolean' ? p.isMuted : current.isMuted
        const activeSourceId =
          typeof p.activeSourceId === 'string' || p.activeSourceId === null
            ? (p.activeSourceId as string | null)
            : current.activeSourceId

        return {
          ...current,
          settings: { ...current.settings, ...persistedSettings },
          sources: persistedSources,
          activeSourceId,
          volume,
          isMuted,
          favoriteIds
        }
      }
    }
  )
)
