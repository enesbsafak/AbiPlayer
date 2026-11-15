import { describe, expect, it, vi } from 'vitest'
import type { PlayerPatch } from '@/store/player-slice'
import { createHtml5TrackSync, type Html5TrackStoreView } from './html5-track-sync'
import { FRESH_TRACK_PREFERENCES } from './track-reconciler'

function setup(overrides: Partial<Html5TrackStoreView> = {}, probed: Array<{ id: string; name: string }> = []) {
  let store: Html5TrackStoreView = {
    audioTracks: [],
    subtitleTracks: [],
    videoQualityOptions: [],
    currentVideoQuality: null,
    activeVideoQuality: null,
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    isSubtitleTrackUserChoice: false,
    settings: { preferredAudioLanguage: 'auto', preferredSubtitleLanguage: 'tr', defaultSubtitleEnabled: true },
    ...overrides
  }
  const patches: PlayerPatch[] = []
  const applyPlayerPatch = vi.fn((patch: PlayerPatch) => {
    patches.push(patch)
    store = { ...store, ...(patch as Partial<Html5TrackStoreView>) }
  })
  const video = { textTracks: [] as unknown as TextTrackList } as unknown as HTMLVideoElement
  const preferences = { current: FRESH_TRACK_PREFERENCES }
  const sync = createHtml5TrackSync({
    video,
    getHls: () => null,
    getProbedTracks: () => probed.map((track) => ({ ...track, type: 'embedded' as const })),
    getStore: () => store,
    applyPlayerPatch,
    setActiveSubtitleCues: vi.fn(),
    preferences
  })
  return { sync, patches, preferences, getStore: () => store }
}

describe('createHtml5TrackSync', () => {
  it('applies the subtitle preference to probed streams and publishes nothing unchanged', () => {
    const { sync, patches, getStore } = setup({}, [
      { id: 'probe:2', name: 'EN' },
      { id: 'probe:3', name: 'TR' }
    ])
    // The preference picks by language; neither carries one, so the first.
    sync.refreshSubtitleTracks()
    expect(getStore().currentSubtitleTrack).toBe('probe:2')

    const before = patches.length
    sync.refreshSubtitleTracks()
    expect(patches.length).toBe(before)
  })

  it('clears an invalid selection together with its cues', () => {
    const { sync, patches } = setup({ currentSubtitleTrack: 'hls:5' }, [{ id: 'probe:2', name: 'EN' }])
    sync.refreshSubtitleTracks()
    expect(patches.at(-1)).toMatchObject({ currentSubtitleTrack: 'probe:2' })
    const cleared = setup({ currentSubtitleTrack: 'hls:5' })
    cleared.sync.refreshSubtitleTracks()
    expect(cleared.patches.at(-1)).toEqual({ currentSubtitleTrack: null, subtitleCues: [], activeSubtitleCues: [] })
  })

  it('keeps a loaded subtitle file on a stream without tracks', () => {
    const { sync, patches } = setup({ currentSubtitleTrack: 'external' })
    sync.refreshMediaTracks()
    expect(patches.some((patch) => 'currentSubtitleTrack' in patch)).toBe(false)
  })

  it('has no quality options without hls.js', () => {
    const { sync, patches } = setup({ currentVideoQuality: 'auto', activeVideoQuality: 'hls-v:0' })
    sync.refreshVideoQualities()
    expect(patches.at(-1)).toEqual({ currentVideoQuality: null, activeVideoQuality: null })
  })
})
