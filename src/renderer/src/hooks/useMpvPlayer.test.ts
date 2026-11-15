import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MpvStateSnapshot, MpvTrackInfo } from '@/services/platform'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    mpvIsAvailable: vi.fn(() => Promise.resolve(true)),
    mpvOpen: vi.fn(() => Promise.resolve()),
    mpvStop: vi.fn(() => Promise.resolve()),
    mpvGetState: vi.fn(),
    mpvSetSubtitleTrack: vi.fn(() => Promise.resolve()),
    windowIsFullscreen: vi.fn(() => Promise.resolve(false))
  }
})

import { mpvGetState, mpvOpen } from '@/services/platform'
import {
  MAX_AUTO_RECONNECT,
  MPV_CONNECTION_LOST_MESSAGE,
  isSnapshotForCurrentStream,
  planMpvReconnect,
  reconcileMpvTrackSelection,
  shouldKeepStartupOverlay,
  useMpvPlayer,
  type MpvTrackSelectionState,
  type MpvTrackSelectionStore
} from './useMpvPlayer'

function createSnapshot(overrides: Partial<MpvStateSnapshot> = {}): MpvStateSnapshot {
  return {
    available: true,
    running: false,
    paused: true,
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

const EXPECTED_PLAYBACK = { playbackId: 'pb-1', url: 'https://example.com/live.m3u8' }

describe('shouldKeepStartupOverlay', () => {
  it('hides the overlay when a stamped snapshot belongs to another playback', () => {
    const snapshot = { ...createSnapshot({ path: EXPECTED_PLAYBACK.url }), playbackId: 'pb-0' }
    expect(shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)).toBe(false)
    expect(
      shouldKeepStartupOverlay({ ...snapshot, playbackId: 'pb-1' }, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(true)
  })

  it('keeps the overlay while mpv is still idle for the target stream', () => {
    const snapshot = createSnapshot()

    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(true)
  })

  it('hides the overlay once track metadata arrives', () => {
    const snapshot = createSnapshot({
      path: 'https://example.com/live.m3u8',
      tracks: [
        {
          id: 1,
          type: 'audio',
          selected: true,
          external: false
        }
      ]
    })

    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay when mpv starts buffering the stream', () => {
    const snapshot = createSnapshot({
      path: 'https://example.com/live.m3u8',
      running: true,
      paused: false,
      buffering: true
    })

    // Once mpv is running and actively loading, startup overlay should clear
    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay when mpv reports an error', () => {
    const snapshot = createSnapshot({
      error: 'network timeout'
    })

    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay after the startup timeout elapses', () => {
    const snapshot = createSnapshot()

    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 17_000)
    ).toBe(false)
  })

  it('hides the overlay when mpv loaded a different path than expected', () => {
    const snapshot = createSnapshot({
      path: 'https://example.com/other-stream.m3u8'
    })

    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay when mpv is actively playing (not paused, not buffering)', () => {
    const snapshot = createSnapshot({
      running: true,
      paused: false,
      buffering: false
    })

    expect(
      shouldKeepStartupOverlay(snapshot, EXPECTED_PLAYBACK, 1_000, 2_000)
    ).toBe(false)
  })
})

describe('isSnapshotForCurrentStream', () => {
  const stream = {
    playback: { playbackId: 'pb-2', url: 'https://e.com/b.ts' },
    previousUrl: 'https://e.com/a.ts',
    opened: true
  }

  it('rejects everything until mpv has accepted the current stream', () => {
    expect(
      isSnapshotForCurrentStream({ path: 'https://e.com/b.ts' }, { ...stream, opened: false })
    ).toBe(false)
  })

  it('rejects a snapshot still on the stream that was just left', () => {
    expect(isSnapshotForCurrentStream({ path: 'https://e.com/a.ts' }, stream)).toBe(false)
  })

  it('accepts the current path, no path yet, or mpv resolving ours to another name', () => {
    expect(isSnapshotForCurrentStream({ path: 'https://e.com/b.ts' }, stream)).toBe(true)
    expect(isSnapshotForCurrentStream({ path: null }, stream)).toBe(true)
    expect(isSnapshotForCurrentStream({ path: 'https://cdn.e.com/b-entry.ts' }, stream)).toBe(true)
  })

  it('rejects everything when nothing is loaded', () => {
    expect(isSnapshotForCurrentStream({ path: null }, { ...stream, playback: null })).toBe(false)
  })

  it('judges a stamped snapshot by its playback id, not its path', () => {
    // A reload of the same URL: the path matches, the playback does not.
    expect(isSnapshotForCurrentStream({ path: 'https://e.com/b.ts', playbackId: 'pb-1' }, stream)).toBe(false)
    expect(isSnapshotForCurrentStream({ path: 'https://e.com/a.ts', playbackId: 'pb-2' }, stream)).toBe(true)
  })
})

describe('planMpvReconnect', () => {
  const base = {
    isLive: true,
    error: null,
    isStalled: false,
    canReconnect: true,
    attempts: 0,
    currentPlayerError: null
  }

  it('clears the message once playback is healthy', () => {
    expect(planMpvReconnect({ ...base, currentPlayerError: 'x' })).toEqual({
      scheduleAttempt: null,
      playerError: null
    })
  })

  it('schedules the next attempt for a stalled live stream', () => {
    expect(planMpvReconnect({ ...base, isStalled: true, attempts: 2 })).toEqual({
      scheduleAttempt: 3,
      playerError: `Bağlantı kesildi, yeniden bağlanılıyor... (3/${MAX_AUTO_RECONNECT})`
    })
  })

  it('keeps the current message while an attempt is already pending', () => {
    expect(
      planMpvReconnect({
        ...base,
        isStalled: true,
        canReconnect: false,
        currentPlayerError: 'bekliyor'
      })
    ).toEqual({ scheduleAttempt: null, playerError: 'bekliyor' })
  })

  it('ends on a final message instead of sticking at the last attempt counter', () => {
    const stuck = `Bağlantı kesildi, yeniden bağlanılıyor... (${MAX_AUTO_RECONNECT}/${MAX_AUTO_RECONNECT})`
    expect(
      planMpvReconnect({
        ...base,
        isStalled: true,
        attempts: MAX_AUTO_RECONNECT,
        currentPlayerError: stuck
      })
    ).toEqual({ scheduleAttempt: null, playerError: MPV_CONNECTION_LOST_MESSAGE })
  })

  it('shows the mpv error for a film instead of reconnecting', () => {
    expect(planMpvReconnect({ ...base, isLive: false, error: 'Dosya açılamadı' })).toEqual({
      scheduleAttempt: null,
      playerError: 'Dosya açılamadı'
    })
  })
})

function track(overrides: Partial<MpvTrackInfo> & Pick<MpvTrackInfo, 'id' | 'type'>): MpvTrackInfo {
  return { selected: false, external: false, ...overrides }
}

const FRESH: MpvTrackSelectionState = {
  audioPreferenceApplied: false,
  subtitlePreferenceApplied: false,
  subtitlesOffByDefault: false
}

function selectionStore(overrides: Partial<MpvTrackSelectionStore> = {}): MpvTrackSelectionStore {
  return {
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    isSubtitleTrackUserChoice: false,
    settings: {
      preferredAudioLanguage: 'auto',
      preferredSubtitleLanguage: 'tr',
      defaultSubtitleEnabled: true
    },
    ...overrides
  }
}

const loadedTracks = [
  track({ id: 1, type: 'video', selected: true }),
  track({ id: 1, type: 'audio', selected: true, lang: 'en' }),
  track({ id: 1, type: 'sub', lang: 'en' }),
  track({ id: 2, type: 'sub', lang: 'tr' })
]

describe('reconcileMpvTrackSelection', () => {
  it('keeps the subtitle preference for when the track list arrives', () => {
    const opening = reconcileMpvTrackSelection(
      { tracks: [], aid: null, sid: null },
      selectionStore(),
      FRESH
    )
    expect(opening.subtitleTrack).toBeUndefined()
    expect(opening.state.subtitlePreferenceApplied).toBe(false)

    const loaded = reconcileMpvTrackSelection(
      { tracks: loadedTracks, aid: 1, sid: null },
      selectionStore(),
      opening.state
    )
    expect(loaded.subtitleTrack).toBe('mpv-s:2')
    expect(loaded.state.subtitlePreferenceApplied).toBe(true)
  })

  it('does not switch subtitles back on after the viewer turned them off', () => {
    // mpv has not processed "sid=no" yet and still reports the old track.
    const result = reconcileMpvTrackSelection(
      { tracks: loadedTracks, aid: 1, sid: 2 },
      selectionStore({ currentAudioTrack: 'mpv-a:1', isSubtitleTrackUserChoice: true }),
      { ...FRESH, audioPreferenceApplied: true, subtitlePreferenceApplied: true }
    )
    expect(result.subtitleTrack).toBeUndefined()
  })

  it('does not apply the preference over a choice the viewer already made', () => {
    const result = reconcileMpvTrackSelection(
      { tracks: loadedTracks, aid: 1, sid: 1 },
      selectionStore({ currentSubtitleTrack: 'mpv-s:1', isSubtitleTrackUserChoice: true }),
      FRESH
    )
    expect(result.subtitleTrack).toBeUndefined()
    expect(result.state.subtitlePreferenceApplied).toBe(true)
  })

  it('still mirrors a subtitle mpv picked when nobody chose one', () => {
    const result = reconcileMpvTrackSelection(
      { tracks: loadedTracks, aid: 1, sid: 1 },
      selectionStore({ currentAudioTrack: 'mpv-a:1' }),
      { ...FRESH, audioPreferenceApplied: true, subtitlePreferenceApplied: true }
    )
    expect(result.subtitleTrack).toBe('mpv-s:1')
  })

  it('turns off a subtitle mpv picked on its own when the setting says off, and keeps it off', () => {
    const store = selectionStore({
      settings: {
        preferredAudioLanguage: 'auto',
        preferredSubtitleLanguage: 'tr',
        defaultSubtitleEnabled: false
      }
    })
    const first = reconcileMpvTrackSelection({ tracks: loadedTracks, aid: 1, sid: 1 }, store, FRESH)
    expect(first.subtitleTrack).toBeUndefined()
    expect(first.disableMpvSubtitles).toBe(true)

    const next = reconcileMpvTrackSelection(
      { tracks: loadedTracks, aid: 1, sid: 1 },
      store,
      first.state
    )
    expect(next.subtitleTrack).toBeUndefined()
  })
})

const liveA: Channel = {
  id: 'a',
  name: 'A',
  streamUrl: 'https://e.com/live/a.ts',
  sourceId: 's',
  type: 'live'
}
const liveB: Channel = {
  id: 'b',
  name: 'B',
  streamUrl: 'https://e.com/live/b.ts',
  sourceId: 's',
  type: 'live'
}

function runningSnapshot(overrides: Partial<MpvStateSnapshot>): MpvStateSnapshot {
  return createSnapshot({ running: true, paused: false, ...overrides })
}

describe('useMpvPlayer poll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.getState().stopPlayback()
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
    useStore.getState().stopPlayback()
    useStore.getState().resetSettings()
    vi.useRealTimers()
  })

  it('does not start a new state request while the previous one is unanswered', async () => {
    vi.mocked(mpvGetState).mockReturnValue(new Promise<MpvStateSnapshot>(() => undefined))
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(vi.mocked(mpvGetState)).toHaveBeenCalledTimes(1)
  })

  it('ignores snapshots taken before mpv has opened the new stream', async () => {
    let openStream: () => void = () => undefined
    vi.mocked(mpvOpen).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          openStream = resolve
        })
    )
    // Still the previous channel, with its own track list.
    vi.mocked(mpvGetState).mockResolvedValue(
      runningSnapshot({ path: liveA.streamUrl, tracks: loadedTracks, aid: 1, sid: 2 })
    )
    useStore.getState().updateSettings({
      defaultSubtitleEnabled: true,
      preferredSubtitleLanguage: 'tr'
    })
    act(() => useStore.getState().playChannel(liveB))
    renderHook(() => useMpvPlayer(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(useStore.getState().subtitleTracks).toEqual([])

    vi.mocked(mpvGetState).mockResolvedValue(
      runningSnapshot({ path: liveB.streamUrl, tracks: loadedTracks, aid: 1, sid: null })
    )
    await act(async () => {
      openStream()
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(useStore.getState().subtitleTracks).toHaveLength(2)
    // The preference was still there to apply to the real track list.
    expect(useStore.getState().currentSubtitleTrack).toBe('mpv-s:2')
  })

  it('cancels a reconnect scheduled for the previous channel', async () => {
    vi.mocked(mpvOpen).mockResolvedValue(undefined)
    vi.mocked(mpvGetState).mockResolvedValue(
      runningSnapshot({ path: liveA.streamUrl, error: 'Bağlantı hatası', tracks: loadedTracks })
    )
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(useStore.getState().playerError).toContain('(1/')

    vi.mocked(mpvGetState).mockReturnValue(new Promise<MpvStateSnapshot>(() => undefined))
    act(() => useStore.getState().playChannel(liveB))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    const opens = vi.mocked(mpvOpen).mock.calls.map(([url]) => url)
    expect(opens.filter((url) => url === liveB.streamUrl)).toHaveLength(1)
    expect(opens.filter((url) => url === liveA.streamUrl)).toHaveLength(1)
  })

  it('opens the same stream again on reload', async () => {
    vi.mocked(mpvOpen).mockResolvedValue(undefined)
    vi.mocked(mpvGetState).mockResolvedValue(runningSnapshot({ path: liveA.streamUrl }))
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(vi.mocked(mpvOpen)).toHaveBeenCalledTimes(1)

    await act(async () => {
      useStore.getState().reloadPlayback()
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(vi.mocked(mpvOpen)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(mpvOpen)).toHaveBeenLastCalledWith(liveA.streamUrl)
  })

  it('reports the playback as loaded once mpv has a duration for it', async () => {
    vi.mocked(mpvOpen).mockResolvedValue(undefined)
    vi.mocked(mpvGetState).mockResolvedValue(runningSnapshot({ path: film.streamUrl, duration: 0 }))
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(useStore.getState().loadedPlaybackId).toBeNull()

    vi.mocked(mpvGetState).mockResolvedValue(runningSnapshot({ path: film.streamUrl, duration: 5400 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(useStore.getState().loadedPlaybackId).toBe(useStore.getState().currentPlayback?.playbackId)
  })

  it('does not count a snapshot of the previous attempt as the reloaded one loading', async () => {
    vi.mocked(mpvOpen).mockResolvedValue(undefined)
    act(() => useStore.getState().playChannel(film))
    const previous = useStore.getState().currentPlayback!.playbackId
    act(() => useStore.getState().reloadPlayback())
    vi.mocked(mpvGetState).mockResolvedValue({
      ...runningSnapshot({ path: film.streamUrl, duration: 5400 }),
      playbackId: previous
    } as MpvStateSnapshot)
    renderHook(() => useMpvPlayer(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(useStore.getState().loadedPlaybackId).toBeNull()
  })
})

const film: Channel = {
  id: 'f',
  name: 'Film',
  streamUrl: 'https://e.com/movie/f.mkv',
  sourceId: 's',
  type: 'vod'
}
