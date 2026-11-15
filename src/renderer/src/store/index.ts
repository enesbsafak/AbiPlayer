import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createSettingsSlice, normalizeSettings, type SettingsSlice } from './settings-slice'
import { createAuthSlice, type AuthSlice } from './auth-slice'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import { createEpgSlice, type EpgSlice } from './epg-slice'
import {
  createFavoritesSlice,
  sanitizeFavoriteSnapshot,
  type FavoriteSnapshot,
  type FavoritesSlice
} from './favorites-slice'
import { createNavigationSlice, type NavigationSlice } from './navigation-slice'
import { createWatchProgressSlice, type WatchProgressSlice } from './watch-progress-slice'
import { createPersistController, type PersistBackend, type SideStorage } from './persistence'
import { PERSIST_VERSION, runPersistMigrations } from './persist-migrations'
import { sanitizeProgressEntries, type WatchProgressEntry } from '@/services/watch-progress'
import type { PlaylistSource } from '@/types/playlist'
import { perfMark, perfWatchStore } from '@/services/perf'

export type AppStore =
  & SettingsSlice
  & AuthSlice
  & PlaylistSlice
  & PlayerSlice
  & EpgSlice
  & FavoritesSlice
  & NavigationSlice
  & WatchProgressSlice

export const STORE_NAME = 'iptv-player-store'
export { PERSIST_VERSION }

/** What is written to storage. Everything else in the store is session state. */
export interface PersistedStoreState {
  settings: AppStore['settings']
  sources: PlaylistSource[]
  activeSourceId: string | null
  volume: number
  isMuted: boolean
  favoriteIds: string[]
  /** One per favourite id, so favourites render before (or without) their catalog. */
  favoriteSnapshots: FavoriteSnapshot[]
  hiddenCategoryIds: string[]
  watchProgress: WatchProgressEntry[]
}

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

function createBackupFallbackStorage(): PersistBackend {
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

const localSideStorage: SideStorage = { getItem: safeLocalGet, setItem: safeLocalSet }

/**
 * Builds the persisted subset. Returns the same object as long as none of the
 * persisted parts changed identity: the storage layer uses that to skip writes,
 * so playback ticks (time, buffering, tracks) never re-serialize the store.
 */
export function createPartialize(): (state: AppStore) => PersistedStoreState {
  let lastParts: readonly unknown[] | null = null
  let last: PersistedStoreState | null = null

  return (state) => {
    const parts = [
      state.settings,
      state.sources,
      state.activeSourceId,
      state.volume,
      state.isMuted,
      state.favoriteIds,
      state.favoriteSnapshots,
      state.hiddenCategoryIds,
      state.watchProgress
    ]
    if (last && lastParts && parts.every((part, index) => part === lastParts![index])) return last

    lastParts = parts
    last = {
      settings: state.settings,
      sources: state.sources.map((source) => {
        if (source.type !== 'xtream') return source
        const { username: _username, password: _password, ...safeSource } = source
        return safeSource
      }),
      activeSourceId: state.activeSourceId,
      volume: state.volume,
      isMuted: state.isMuted,
      favoriteIds: Array.from(state.favoriteIds),
      favoriteSnapshots: Array.from(state.favoriteIds, (id) => state.favoriteSnapshots[id]).filter(
        (snapshot): snapshot is FavoriteSnapshot => !!snapshot
      ),
      hiddenCategoryIds: Array.from(state.hiddenCategoryIds),
      watchProgress: state.watchProgress
    }
    return last
  }
}

export const partializeStore = createPartialize()

/**
 * Only accepts known keys from persisted state. Spreading raw `persisted` can
 * inject arbitrary keys (volatile state, prototype fields) if the payload is
 * tampered with. Keep this in sync with `createPartialize` above.
 */
export function mergePersistedState(persisted: unknown, current: AppStore): AppStore {
  const p = (persisted && typeof persisted === 'object'
    ? (persisted as Record<string, unknown>)
    : {}) as Record<string, unknown>

  const persistedSources = sanitizePersistedSources(p.sources, current.sources)
  const settings =
    p.settings && typeof p.settings === 'object' ? normalizeSettings(p.settings) : current.settings

  const rawFavoriteIds = Array.isArray(p.favoriteIds) ? p.favoriteIds : []
  const favoriteIds = new Set<string>()
  for (const item of rawFavoriteIds) {
    if (typeof item === 'string') favoriteIds.add(item)
  }

  const favoriteSnapshots: Record<string, FavoriteSnapshot> = {}
  if (Array.isArray(p.favoriteSnapshots)) {
    for (const raw of p.favoriteSnapshots) {
      const snapshot = sanitizeFavoriteSnapshot(raw)
      if (snapshot && favoriteIds.has(snapshot.id)) favoriteSnapshots[snapshot.id] = snapshot
    }
  }

  const rawHiddenCategoryIds = Array.isArray(p.hiddenCategoryIds) ? p.hiddenCategoryIds : []
  const hiddenCategoryIds = new Set<string>()
  for (const item of rawHiddenCategoryIds) {
    if (typeof item === 'string') hiddenCategoryIds.add(item)
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

  // Restoring from the update backup is asynchronous, so the credential
  // hydration in useAutoConnect can finish first, against the empty default
  // source list, and mark itself done. The sources arriving here carry no
  // credentials (they are never persisted), so it has to run again.
  const credentialsHydrated =
    current.credentialsHydrated &&
    !persistedSources.some(
      (source) => source.type === 'xtream' && !(source.username && source.password)
    )

  return {
    ...current,
    settings,
    sources: persistedSources,
    activeSourceId,
    volume,
    isMuted,
    favoriteIds,
    favoriteSnapshots,
    hiddenCategoryIds,
    watchProgress: sanitizeProgressEntries(p.watchProgress),
    credentialsHydrated
  }
}

export const storePersistence = createPersistController<PersistedStoreState>({
  name: STORE_NAME,
  backend: createBackupFallbackStorage(),
  sideStorage: localSideStorage
})

/**
 * Writes any pending store change to localStorage now. Call it before anything
 * outside the renderer reads the stored state (the updater's backup before an
 * install), and after a save that must survive the page going away.
 */
export function flushPersistedStore(): void {
  storePersistence.flush()
}

/**
 * Turns stored state of any older version into the current shape. Never
 * throws (see `runPersistMigrations`); a failed step is retried next start.
 */
export function migratePersistedState(persisted: unknown, version: number): PersistedStoreState {
  const outcome = runPersistMigrations(persisted, version)
  if (outcome.failure) {
    console.warn(
      `[store] migration "${outcome.failure.name}" (v${outcome.failure.version}) failed; keeping v${outcome.version} data:`,
      outcome.failure.error
    )
    storePersistence.preserveStoredCopy(`v${version}-before-migration`)
    // Written back labelled with the last good version, so the failed step
    // runs again next time instead of being skipped for good.
    storePersistence.setWriteVersion(outcome.version)
  } else if (outcome.fromNewerVersion) {
    console.warn(
      `[store] stored state is from a newer version (v${version} > v${PERSIST_VERSION}); keeping a copy of it`
    )
    storePersistence.preserveStoredCopy(`v${version}`)
  }
  // Every key is validated by `mergePersistedState`, which runs next.
  return outcome.state as unknown as PersistedStoreState
}

perfMark('renderer:store-create')
export const useStore = create<AppStore>()(
  persist(
    (...a) => ({
      ...createSettingsSlice(...a),
      ...createAuthSlice(...a),
      ...createPlaylistSlice(...a),
      ...createPlayerSlice(...a),
      ...createEpgSlice(...a),
      ...createFavoritesSlice(...a),
      ...createNavigationSlice(...a),
      ...createWatchProgressSlice(...a)
    }),
    {
      name: STORE_NAME,
      version: PERSIST_VERSION,
      storage: storePersistence.storage,
      partialize: partializeStore,
      migrate: migratePersistedState,
      merge: mergePersistedState,
      onRehydrateStorage: () => {
        storePersistence.beginHydration()
        return (state, error) => {
          if (error) {
            console.warn('[store] loading the persisted state failed; keeping a copy of it:', error)
            storePersistence.preserveStoredCopy('unloaded')
          }
          // What storage holds now matches the loaded state; only a change
          // from here on needs a write.
          storePersistence.markHydrated(state ? partializeStore(state) : undefined)
        }
      }
    }
  )
)
perfWatchStore(useStore)

declare global {
  interface Window {
    /**
     * Flushes pending store writes. For the main process, which reads the
     * stored state with `executeJavaScript` before installing an update.
     */
    __abiPlayerFlushStore?: () => void
  }
}

if (typeof window !== 'undefined') {
  window.__abiPlayerFlushStore = flushPersistedStore
  // Leaving the page: write what is pending, and write anything saved after
  // this (the progress recorder's own pagehide save) straight away.
  window.addEventListener('pagehide', () => storePersistence.setImmediate(true))
  window.addEventListener('pageshow', () => storePersistence.setImmediate(false))
  window.addEventListener('beforeunload', flushPersistedStore)
  // The update prompt is a native dialog over this window; the install that
  // may follow reads localStorage from main.
  window.addEventListener('blur', flushPersistedStore)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersistedStore()
  })
}
