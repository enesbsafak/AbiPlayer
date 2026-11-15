import { describe, expect, it } from 'vitest'
import type { MpvStateSnapshot, MpvTrackInfo } from '@/services/platform'
import {
  MPV_STARTUP_OVERLAY_TIMEOUT_MS,
  isNewerSnapshot,
  isSnapshotForPlayback,
  reconcileMpvSnapshot,
  shouldKeepStartupOverlay,
  type MpvStoreView
} from './mpv-snapshot'
import { FRESH_TRACK_PREFERENCES } from './track-reconciler'

function snapshot(overrides: Partial<MpvStateSnapshot> = {}): MpvStateSnapshot {
  return {
    sessionId: 1,
    loadId: 1,
    playbackId: 'pb-1',
    phase: 'playing',
    seq: 1,
    available: true,
    running: true,
    paused: false,
    buffering: false,
    timePos: 0,
    duration: 0,
    demuxerCacheDuration: 0,
    volume: 80,
    muted: false,
    vid: null,
    aid: null,
    sid: null,
    fullscreen: false,
    tracks: [],
    path: null,
    error: null,
    passthroughActive: false,
    ...overrides
  }
}

function store(overrides: Partial<MpvStoreView> = {}): MpvStoreView {
  return {
    isPlaying: true,
    isPaused: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    demuxerCacheDuration: 0,
    isFullscreen: false,
    passthroughActive: false,
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
}

const track = (overrides: Partial<MpvTrackInfo> & Pick<MpvTrackInfo, 'id' | 'type'>): MpvTrackInfo => ({
  selected: false,
  external: false,
  ...overrides
})

describe('snapshot gate', () => {
  it('orders by seq and drops repeats', () => {
    expect(isNewerSnapshot(null, { seq: 3 })).toBe(true)
    expect(isNewerSnapshot(3, { seq: 3 })).toBe(false)
    expect(isNewerSnapshot(3, { seq: 2 })).toBe(false)
    expect(isNewerSnapshot(3, { seq: 4 })).toBe(true)
  })

  it('takes only snapshots stamped with the current playback, never an unstamped one', () => {
    expect(isSnapshotForPlayback({ playbackId: 'pb-1' }, 'pb-1')).toBe(true)
    expect(isSnapshotForPlayback({ playbackId: 'pb-0' }, 'pb-1')).toBe(false)
    expect(isSnapshotForPlayback({ playbackId: null }, 'pb-1')).toBe(false)
    expect(isSnapshotForPlayback({ playbackId: null }, null)).toBe(false)
  })
})

describe('reconcileMpvSnapshot', () => {
  it('publishes only what changed', () => {
    const unchanged = reconcileMpvSnapshot(snapshot(), store(), FRESH_TRACK_PREFERENCES, false)
    expect(unchanged.patch).toEqual({})

    const moved = reconcileMpvSnapshot(
      snapshot({ timePos: 12, buffering: true }),
      store(),
      FRESH_TRACK_PREFERENCES,
      false
    )
    expect(moved.patch).toEqual({ currentTime: 12, isBuffering: true })
  })

  it('maps tracks, applies the preferences once the list is there and picks automatic quality', () => {
    const tracks = [
      track({ id: 1, type: 'video', selected: true, height: 1080 }),
      track({ id: 1, type: 'audio', selected: true, lang: 'en' }),
      track({ id: 3, type: 'sub', lang: 'tur' })
    ]
    const result = reconcileMpvSnapshot(snapshot({ tracks, aid: 1, vid: 1 }), store(), FRESH_TRACK_PREFERENCES, false)
    expect(result.patch).toMatchObject({
      currentAudioTrack: 'mpv-a:1',
      currentSubtitleTrack: 'mpv-s:3',
      currentVideoQuality: 'auto',
      activeVideoQuality: 'mpv-v:1'
    })
    expect(result.patch.audioTracks).toHaveLength(1)
    expect(result.preferences).toMatchObject({ audioPreferenceApplied: true, subtitlePreferenceApplied: true })
  })

  it('leaves selections and preferences alone while the load has no track list yet', () => {
    const result = reconcileMpvSnapshot(
      snapshot({ phase: 'loading' }),
      store({ currentAudioTrack: 'mpv-a:2' }),
      FRESH_TRACK_PREFERENCES,
      false
    )
    expect(result.patch.currentAudioTrack).toBeUndefined()
    expect(result.preferences).toEqual(FRESH_TRACK_PREFERENCES)
  })

  it('is fullscreen when either the window or mpv is', () => {
    expect(reconcileMpvSnapshot(snapshot(), store(), FRESH_TRACK_PREFERENCES, true).patch.isFullscreen).toBe(true)
    expect(
      reconcileMpvSnapshot(snapshot({ fullscreen: true }), store(), FRESH_TRACK_PREFERENCES, false).patch.isFullscreen
    ).toBe(true)
  })
})

describe('shouldKeepStartupOverlay', () => {
  it('keeps the overlay until the playback shows signs of life', () => {
    expect(shouldKeepStartupOverlay(null, 1_000, 2_000)).toBe(true)
    expect(shouldKeepStartupOverlay(snapshot({ phase: 'loading', paused: true }), 1_000, 2_000)).toBe(true)
    expect(shouldKeepStartupOverlay(snapshot({ phase: 'loading' }), 1_000, 2_000)).toBe(false)
    expect(shouldKeepStartupOverlay(snapshot({ paused: true, timePos: 1 }), 1_000, 2_000)).toBe(false)
    expect(shouldKeepStartupOverlay(snapshot({ paused: true, tracks: [track({ id: 1, type: 'audio' })] }), 1_000, 2_000)).toBe(false)
  })

  it('drops the overlay on an error and after the time limit', () => {
    expect(shouldKeepStartupOverlay(snapshot({ phase: 'error', paused: true, error: 'x' }), 1_000, 2_000)).toBe(false)
    expect(shouldKeepStartupOverlay(null, 1_000, 1_000 + MPV_STARTUP_OVERLAY_TIMEOUT_MS)).toBe(false)
    expect(shouldKeepStartupOverlay(null, null, 2_000)).toBe(false)
  })
})
