import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types/settings'
import type { PlaylistSource } from '@/types/playlist'
import {
  createPartialize,
  mergePersistedState,
  PERSIST_VERSION,
  STORE_NAME,
  storePersistence,
  useStore,
  type AppStore
} from './index'

const xtreamSource: PlaylistSource = {
  id: 'xt',
  name: 'Panel',
  type: 'xtream',
  url: 'http://panel.example',
  username: 'ahmet',
  password: 's3cret',
  addedAt: 1
}

const disk = new Map<string, string>()
const writes: string[] = []

function useMemoryBackend(getItem?: (name: string) => string | null | Promise<string | null>) {
  storePersistence.setBackend(
    {
      getItem: getItem ?? ((name) => disk.get(name) ?? null),
      setItem: (name, value) => {
        if (name === STORE_NAME) writes.push(value)
        disk.set(name, value)
      },
      removeItem: (name) => void disk.delete(name)
    },
    { getItem: (name) => disk.get(name) ?? null, setItem: (name, value) => void disk.set(name, value) }
  )
}

function stored(): { state: Record<string, unknown>; version: number } {
  return JSON.parse(disk.get(STORE_NAME) ?? 'null')
}

beforeEach(() => {
  disk.clear()
  writes.length = 0
  useMemoryBackend()
})

afterEach(() => {
  storePersistence.flush()
  useStore.setState({ settings: DEFAULT_SETTINGS, sources: [], watchProgress: [], credentialsHydrated: false })
  storePersistence.flush()
})

describe('partialize', () => {
  it('returns the same object while no persisted part changed', () => {
    const partialize = createPartialize()
    const state = useStore.getState()
    const first = partialize(state)
    expect(partialize({ ...state, currentTime: 12, isBuffering: true } as AppStore)).toBe(first)
    expect(partialize({ ...state, volume: 0.3 } as AppStore)).not.toBe(first)
  })

  it('never persists Xtream credentials or session state', () => {
    const partialize = createPartialize()
    const persisted = partialize({ ...useStore.getState(), sources: [xtreamSource] } as AppStore)
    expect(JSON.stringify(persisted)).not.toContain('s3cret')
    expect(persisted.sources[0]).not.toHaveProperty('username')
    expect(Object.keys(persisted).sort()).toEqual(
      [
        'activeSourceId',
        'favoriteIds',
        'favoriteSnapshots',
        'hiddenCategoryIds',
        'isMuted',
        'settings',
        'sources',
        'volume',
        'watchProgress'
      ].sort()
    )
  })

  it('persists one snapshot per favourite, in favourite order, without credentials', () => {
    const partialize = createPartialize()
    const persisted = partialize({
      ...useStore.getState(),
      favoriteIds: new Set(['x_live_2', 'm3u_1']),
      favoriteSnapshots: {
        m3u_1: { id: 'm3u_1', name: 'Liste', sourceId: 'm', type: 'live', streamUrl: 'http://cdn.test/1.ts' },
        x_live_2: { id: 'x_live_2', name: 'Kanal', sourceId: 'x', type: 'live', streamId: 2 },
        stale: { id: 'stale', name: 'Eski', sourceId: 'x', type: 'live', streamId: 9 }
      }
    } as AppStore)
    expect(persisted.favoriteSnapshots.map((snapshot) => snapshot.id)).toEqual(['x_live_2', 'm3u_1'])
    expect(persisted.favoriteSnapshots[0]).not.toHaveProperty('streamUrl')
  })
})

describe('mergePersistedState', () => {
  const current = () => useStore.getState()

  it('accepts known keys only and normalizes settings', () => {
    const merged = mergePersistedState(
      {
        settings: { theme: 'light', epgRefreshInterval: 99999, subtitleFontSize: 'big' },
        volume: 4,
        favoriteIds: ['a', 3],
        currentChannel: { id: 'injected' },
        isPlaying: true
      },
      current()
    )
    expect(merged.settings).not.toHaveProperty('theme')
    expect(merged.settings.epgRefreshInterval).toBe(1440)
    expect(merged.settings.subtitleFontSize).toBe(DEFAULT_SETTINGS.subtitleFontSize)
    expect(merged.volume).toBe(1)
    expect([...merged.favoriteIds]).toEqual(['a'])
    expect(merged.currentChannel).toBeNull()
    expect(merged.isPlaying).toBe(false)
  })

  it('keeps valid snapshots of known favourites only', () => {
    const merged = mergePersistedState(
      {
        favoriteIds: ['x_live_2', 'x_vod_3', 'm3u_bad'],
        favoriteSnapshots: [
          { id: 'x_live_2', name: 'Kanal', sourceId: 'x', type: 'live', streamId: 2, streamUrl: 'http://h/live/u/p/2.ts' },
          { id: 'x_vod_3', name: 'Film', sourceId: 'x', type: 'vod' },
          { id: 'm3u_bad', name: 'Liste', sourceId: 'm', type: 'live', streamUrl: 'javascript:alert(1)' },
          { id: 'unknown', name: 'Yabancı', sourceId: 'x', type: 'live', streamId: 4 },
          'garbage'
        ]
      },
      current()
    )
    expect(Object.keys(merged.favoriteSnapshots)).toEqual(['x_live_2'])
    // A URL on an Xtream item would carry its credentials.
    expect(merged.favoriteSnapshots.x_live_2).not.toHaveProperty('streamUrl')
  })

  it('falls back to the current values for garbage', () => {
    const merged = mergePersistedState('garbage', current())
    expect(merged.settings).toBe(current().settings)
    expect(merged.sources).toBe(current().sources)
  })

  it('asks for credentials again when they were hydrated before the sources arrived (F4-10)', () => {
    const hydratedEarly = { ...current(), credentialsHydrated: true, sources: [] } as AppStore
    const { username: _u, password: _p, ...persistedSource } = xtreamSource
    const merged = mergePersistedState({ sources: [persistedSource] }, hydratedEarly)
    expect(merged.credentialsHydrated).toBe(false)

    expect(mergePersistedState({ sources: [] }, hydratedEarly).credentialsHydrated).toBe(true)
  })
})

describe('persisted store', () => {
  it('migrates a version 0 payload on load and does not write it back unchanged', async () => {
    disk.set(
      STORE_NAME,
      JSON.stringify({
        state: {
          sources: [{ id: 'xt', name: 'Panel', type: 'xtream', addedAt: 1 }],
          watchProgress: [
            {
              key: 'http://h/movie/~abi~/~abi~/55.mkv',
              position: 700,
              duration: 3600,
              updatedAt: 1,
              channel: { id: 'o', name: 'Film', streamUrl: 'http://h/movie/~abi~/~abi~/55.mkv', sourceId: 'xt', type: 'vod' }
            }
          ]
        },
        version: 0
      })
    )

    await useStore.persist.rehydrate()

    expect(useStore.getState().watchProgress[0]?.key).toBe('movie:xt:55')
    storePersistence.flush()
    expect(writes).toEqual([])

    useStore.getState().updateSettings({ subtitleFontSize: 30 })
    storePersistence.flush()
    expect(stored().version).toBe(PERSIST_VERSION)
    expect((stored().state.watchProgress as Array<{ key: string }>)[0].key).toBe('movie:xt:55')
  })

  it('does not touch storage for playback ticks', async () => {
    await useStore.persist.rehydrate()
    useStore.getState().updateSettings({ subtitleFontSize: 28 })
    storePersistence.flush()
    writes.length = 0

    for (let i = 0; i < 100; i++) {
      useStore.getState().applyPlayerPatch({ currentTime: i, isBuffering: i % 2 === 0 })
    }
    storePersistence.flush()

    expect(writes).toEqual([])
  })

  it('keeps a copy of state written by a newer version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const newer = JSON.stringify({ state: { volume: 0.4, futureKey: [1] }, version: PERSIST_VERSION + 5 })
    disk.set(STORE_NAME, newer)

    await useStore.persist.rehydrate()

    expect(useStore.getState().volume).toBe(0.4)
    expect(disk.get(`${STORE_NAME}:v${PERSIST_VERSION + 5}`)).toBe(newer)
    warn.mockRestore()
  })

  it('hydrates credentials again after a slow restore from the update backup (F4-10)', async () => {
    let restore: (value: string) => void = () => undefined
    useMemoryBackend((name) =>
      name === STORE_NAME ? new Promise<string>((resolve) => (restore = resolve)) : null
    )

    const hydration = useStore.persist.rehydrate()
    // useAutoConnect finishes first, against the default (empty) source list.
    useStore.getState().hydrateXtreamCredentials({})
    expect(useStore.getState().credentialsHydrated).toBe(true)

    restore(JSON.stringify({ state: { sources: [{ id: 'xt', name: 'Panel', type: 'xtream', addedAt: 1 }] }, version: PERSIST_VERSION }))
    await hydration

    expect(useStore.getState().sources).toHaveLength(1)
    expect(useStore.getState().credentialsHydrated).toBe(false)
  })
})
