import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { clampEpgRefreshInterval, normalizeSettings } from './settings-slice'
import { useStore } from './index'

const REMOVED_KEYS = ['theme', 'language', 'autoPlay', 'channelViewMode', 'bufferLength']

describe('normalizeSettings', () => {
  it('drops keys that settings no longer declare', () => {
    const normalized = normalizeSettings({
      theme: 'light',
      language: 'en',
      autoPlay: false,
      channelViewMode: 'list',
      bufferLength: 90,
      epgRefreshInterval: 120,
      tmdbApiKey: 'abc'
    })

    for (const key of REMOVED_KEYS) expect(normalized).not.toHaveProperty(key)
    expect(normalized.epgRefreshInterval).toBe(120)
    expect(normalized.tmdbApiKey).toBe('abc')
  })

  it('replaces values of the wrong type with defaults', () => {
    const normalized = normalizeSettings({
      epgRefreshInterval: 'often',
      defaultVolume: Number.NaN,
      epgTimeFormat: '36h',
      hardwareAcceleration: 'yes'
    })

    expect(normalized.epgRefreshInterval).toBe(DEFAULT_SETTINGS.epgRefreshInterval)
    expect(normalized.defaultVolume).toBe(DEFAULT_SETTINGS.defaultVolume)
    expect(normalized.epgTimeFormat).toBe(DEFAULT_SETTINGS.epgTimeFormat)
    expect(normalized.hardwareAcceleration).toBe(DEFAULT_SETTINGS.hardwareAcceleration)
  })

  it('returns the defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('clampEpgRefreshInterval', () => {
  it('clamps to the allowed range', () => {
    expect(clampEpgRefreshInterval(1)).toBe(5)
    expect(clampEpgRefreshInterval(120.7)).toBe(120)
    expect(clampEpgRefreshInterval(99999)).toBe(1440)
  })
})

describe('settings in the store', () => {
  // Node's own experimental localStorage shadows jsdom's and is unusable
  // without a backing file, so the store gets an in-memory one here.
  const memory = new Map<string, string>()

  beforeEach(() => {
    useStore.persist.setOptions({
      storage: createJSONStorage(() => ({
        getItem: (name) => memory.get(name) ?? null,
        setItem: (name, value) => {
          memory.set(name, value)
        },
        removeItem: (name) => {
          memory.delete(name)
        }
      }))
    })
  })

  afterEach(() => {
    memory.clear()
    useStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('loads persisted settings that still contain removed keys', async () => {
    memory.set(
      'iptv-player-store',
      JSON.stringify({
        state: {
          settings: {
            theme: 'light',
            language: 'en',
            autoPlay: false,
            channelViewMode: 'list',
            bufferLength: 90,
            epgRefreshInterval: 30
          }
        },
        version: 0
      })
    )

    await useStore.persist.rehydrate()
    expect(useStore.getState().settings.epgRefreshInterval).toBe(30)

    // The first write rebuilds the object from known keys only.
    useStore.getState().updateSettings({ subtitleFontSize: 30 })
    const settings = useStore.getState().settings
    for (const key of REMOVED_KEYS) expect(settings).not.toHaveProperty(key)
    expect(settings.epgRefreshInterval).toBe(30)
    expect(settings.subtitleFontSize).toBe(30)
  })

  it('keeps the TMDB key when settings are reset', () => {
    useStore.getState().updateSettings({ tmdbApiKey: 'secret-key', epgRefreshInterval: 300 })
    useStore.getState().resetSettings()

    const settings = useStore.getState().settings
    expect(settings.tmdbApiKey).toBe('secret-key')
    expect(settings.epgRefreshInterval).toBe(DEFAULT_SETTINGS.epgRefreshInterval)
  })
})
