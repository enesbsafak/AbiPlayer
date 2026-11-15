import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MpvStateSnapshot, MpvTrackInfo, WindowStateInfo } from '@/services/platform'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

const bridge = vi.hoisted(() => ({
  listeners: new Set<(snapshot: MpvStateSnapshot) => void>(),
  windowListeners: new Set<(state: WindowStateInfo) => void>()
}))

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    mpvOpen: vi.fn(() => Promise.resolve()),
    mpvStop: vi.fn(() => Promise.resolve()),
    mpvSetSubtitleTrack: vi.fn(() => Promise.resolve()),
    mpvSetAudioTrack: vi.fn(() => Promise.resolve()),
    subscribeMpvState: vi.fn((listener: (snapshot: MpvStateSnapshot) => void) => {
      bridge.listeners.add(listener)
      return () => bridge.listeners.delete(listener)
    }),
    onWindowStateChange: vi.fn((listener: (state: WindowStateInfo) => void) => {
      bridge.windowListeners.add(listener)
      return () => bridge.windowListeners.delete(listener)
    }),
    windowGetState: vi.fn(() => Promise.resolve({ isMaximized: false, isFullScreen: false }))
  }
})

import { mpvOpen, mpvSetAudioTrack, mpvSetSubtitleTrack } from '@/services/platform'
import { STALL_THRESHOLD_MS } from '@/player/reconnect-policy'
import { MAX_AUTO_RECONNECT, MPV_CONNECTION_LOST_MESSAGE, useMpvPlayer } from './useMpvPlayer'

let seq = 0

function snapshot(overrides: Partial<MpvStateSnapshot> = {}): MpvStateSnapshot {
  seq += 1
  return {
    sessionId: 1,
    loadId: 1,
    playbackId: null,
    phase: 'idle',
    seq,
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

function track(overrides: Partial<MpvTrackInfo> & Pick<MpvTrackInfo, 'id' | 'type'>): MpvTrackInfo {
  return { selected: false, external: false, ...overrides }
}

const loadedTracks = [
  track({ id: 1, type: 'video', selected: true }),
  track({ id: 1, type: 'audio', selected: true, lang: 'en' }),
  track({ id: 2, type: 'audio', lang: 'tr' }),
  track({ id: 1, type: 'sub', lang: 'en' }),
  track({ id: 2, type: 'sub', lang: 'tr' })
]

const liveA: Channel = { id: 'a', name: 'A', streamUrl: 'https://e.com/live/a.ts', sourceId: 's', type: 'live' }
const liveB: Channel = { id: 'b', name: 'B', streamUrl: 'https://e.com/live/b.ts', sourceId: 's', type: 'live' }
const film: Channel = { id: 'f', name: 'Film', streamUrl: 'https://e.com/movie/f.mkv', sourceId: 's', type: 'vod' }

function playbackId(): string {
  return useStore.getState().currentPlayback!.playbackId
}

/** A snapshot of the current playback, playing. */
function playing(overrides: Partial<MpvStateSnapshot> = {}): MpvStateSnapshot {
  return snapshot({ playbackId: playbackId(), phase: 'playing', running: true, paused: false, ...overrides })
}

async function push(next: MpvStateSnapshot) {
  await act(async () => {
    for (const listener of [...bridge.listeners]) listener(next)
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useMpvPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    bridge.listeners.clear()
    bridge.windowListeners.clear()
    useStore.getState().stopPlayback()
    useStore.getState().updateSettings({ defaultSubtitleEnabled: true, preferredSubtitleLanguage: 'tr' })
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
    useStore.getState().stopPlayback()
    useStore.getState().resetSettings()
    vi.useRealTimers()
  })

  it('subscribes instead of polling and unsubscribes on unmount', async () => {
    act(() => useStore.getState().playChannel(liveA))
    const { unmount } = renderHook(() => useMpvPlayer(true))
    expect(bridge.listeners.size).toBe(1)
    unmount()
    expect(bridge.listeners.size).toBe(0)
  })

  it('opens each playback with its id and tuning', async () => {
    act(() => {
      useStore.getState().playChannel(liveA)
      useStore.getState().setPlaybackTuning({ audioDelay: 0.3 })
    })
    renderHook(() => useMpvPlayer(true))
    await advance(0)

    expect(vi.mocked(mpvOpen)).toHaveBeenCalledWith(liveA.streamUrl, {
      playbackId: playbackId(),
      tuning: expect.objectContaining({ audioDelay: 0.3 })
    })
  })

  it('applies only snapshots stamped with the current playback', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    const previous = playbackId()
    await push(playing({ tracks: loadedTracks, aid: 1 }))
    expect(useStore.getState().audioTracks).toHaveLength(2)

    act(() => useStore.getState().playChannel(liveB))
    // mpv is still on A, and A's snapshots keep coming until B is opened.
    await push(snapshot({ playbackId: previous, phase: 'playing', running: true, tracks: loadedTracks, timePos: 50 }))
    await push(snapshot({ playbackId: null, phase: 'idle' }))
    expect(useStore.getState().audioTracks).toEqual([])
    expect(useStore.getState().currentTime).toBe(0)

    await push(playing({ tracks: loadedTracks, aid: 1, timePos: 3 }))
    expect(useStore.getState().currentTime).toBe(3)
    // The subtitle preference was still there for the real track list.
    expect(useStore.getState().currentSubtitleTrack).toBe('mpv-s:2')
  })

  it('drops out-of-order and repeated snapshots by seq', async () => {
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    const older = playing({ timePos: 10 })
    const newer = playing({ timePos: 20 })

    await push(newer)
    await push(older)
    await push(newer)
    expect(useStore.getState().currentTime).toBe(20)
  })

  it('does not consume the track preferences on a snapshot without tracks', async () => {
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    await push(snapshot({ playbackId: playbackId(), phase: 'loading', running: true }))
    expect(useStore.getState().currentSubtitleTrack).toBeNull()

    await push(playing({ tracks: loadedTracks, aid: 1 }))
    expect(useStore.getState().currentSubtitleTrack).toBe('mpv-s:2')
  })

  it('starts from the full current snapshot after re-subscribing mid-playback', async () => {
    act(() => useStore.getState().playChannel(film))
    const first = renderHook(() => useMpvPlayer(true))
    await push(playing({ timePos: 100, duration: 5400, tracks: loadedTracks, aid: 1 }))
    first.unmount()
    act(() => useStore.getState().applyPlayerPatch({ currentTime: 0, audioTracks: [] }))

    // A reloaded renderer: fresh hook, fresh subscription, whose first delivery
    // repeats a seq already seen by the previous instance.
    renderHook(() => useMpvPlayer(true))
    const current = { ...playing({ timePos: 130, duration: 5400, tracks: loadedTracks, aid: 1 }), seq: 1 }
    await push(current)
    expect(useStore.getState().currentTime).toBe(130)
    expect(useStore.getState().audioTracks).toHaveLength(2)
  })

  it('reports the playback loaded from its phase, never for an earlier attempt', async () => {
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    const earlier = playbackId()
    act(() => useStore.getState().reloadPlayback())

    await push(snapshot({ playbackId: earlier, phase: 'playing', running: true, duration: 5400 }))
    expect(useStore.getState().loadedPlaybackId).toBeNull()

    await push(snapshot({ playbackId: playbackId(), phase: 'loading', running: true }))
    expect(useStore.getState().loadedPlaybackId).toBeNull()

    await push(playing({ duration: 0 }))
    expect(useStore.getState().loadedPlaybackId).toBe(playbackId())
  })

  it('opens the same stream again as a new playback on reload', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await advance(0)
    const first = playbackId()

    act(() => useStore.getState().reloadPlayback())
    await advance(0)

    expect(vi.mocked(mpvOpen)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(mpvOpen).mock.calls[1][0]).toBe(liveA.streamUrl)
    expect(vi.mocked(mpvOpen).mock.calls[1][1].playbackId).not.toBe(first)
  })

  it('reconnects a failed live stream as the same playback, once per failed load', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await advance(0)
    vi.mocked(mpvOpen).mockClear()

    await push(playing({ loadId: 1 }))
    await push(snapshot({ playbackId: playbackId(), loadId: 1, phase: 'error', error: 'Bağlantı hatası' }))
    expect(useStore.getState().playerError).toBe(`Bağlantı kesildi, yeniden bağlanılıyor... (1/${MAX_AUTO_RECONNECT})`)

    await advance(1000)
    expect(vi.mocked(mpvOpen)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(mpvOpen)).toHaveBeenCalledWith(liveA.streamUrl, { playbackId: playbackId() })

    // A late repeat of the same load's error is not a second failure.
    await push(snapshot({ playbackId: playbackId(), loadId: 1, phase: 'error', error: 'Bağlantı hatası' }))
    await advance(5000)
    expect(vi.mocked(mpvOpen)).toHaveBeenCalledTimes(1)

    // The new load plays: the message goes.
    await push(playing({ loadId: 2 }))
    expect(useStore.getState().playerError).toBeNull()
  })

  it('cancels a reconnect scheduled for the previous channel', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await push(snapshot({ playbackId: playbackId(), loadId: 1, phase: 'error', error: 'Bağlantı hatası' }))
    expect(useStore.getState().playerError).toContain('(1/')

    act(() => useStore.getState().playChannel(liveB))
    await advance(5000)

    const opens = vi.mocked(mpvOpen).mock.calls.map(([url]) => url)
    expect(opens.filter((url) => url === liveA.streamUrl)).toHaveLength(1)
    expect(opens.filter((url) => url === liveB.streamUrl)).toHaveLength(1)
  })

  it('notices a stalled live stream although nothing more is reported', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await advance(0)
    vi.mocked(mpvOpen).mockClear()

    await push(playing())
    await push(playing({ buffering: true }))
    await advance(STALL_THRESHOLD_MS + 1)
    expect(useStore.getState().playerError).toContain('(1/')
    await advance(1000)
    expect(vi.mocked(mpvOpen)).toHaveBeenCalledTimes(1)
  })

  it('gives up with a final message after the last attempt', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await push(playing())
    for (let attempt = 1; attempt <= MAX_AUTO_RECONNECT; attempt++) {
      await push(playing({ buffering: true }))
      await advance(STALL_THRESHOLD_MS + 1)
      await advance(attempt * 1000)
    }
    await push(playing({ buffering: true }))
    await advance(STALL_THRESHOLD_MS + 1)
    expect(useStore.getState().playerError).toBe(MPV_CONNECTION_LOST_MESSAGE)
  })

  it('shows a film error as it is instead of reconnecting', async () => {
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    await advance(0)
    vi.mocked(mpvOpen).mockClear()
    await push(snapshot({ playbackId: playbackId(), phase: 'error', error: 'Dosya açılamadı' }))
    await advance(10_000)
    expect(useStore.getState().playerError).toBe('Dosya açılamadı')
    expect(vi.mocked(mpvOpen)).not.toHaveBeenCalled()
  })

  it('takes window fullscreen from the window-state event', async () => {
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    await act(async () => {
      for (const listener of bridge.windowListeners) listener({ isMaximized: false, isFullScreen: true })
    })
    expect(useStore.getState().isFullscreen).toBe(true)
    await push(playing({ fullscreen: false }))
    expect(useStore.getState().isFullscreen).toBe(true)
  })

  it('gives the viewer audio choice back to mpv when a reconnect starts a new load', async () => {
    act(() => useStore.getState().playChannel(liveA))
    renderHook(() => useMpvPlayer(true))
    await push(playing({ loadId: 1, tracks: loadedTracks, aid: 1 }))
    act(() => useStore.getState().setCurrentAudioTrack('mpv-a:2'))
    await push(playing({ loadId: 1, tracks: loadedTracks, aid: 2 }))
    vi.mocked(mpvSetAudioTrack).mockClear()

    // The new load comes up on mpv's default track.
    await push(playing({ loadId: 2, tracks: loadedTracks, aid: 1 }))
    expect(vi.mocked(mpvSetAudioTrack)).toHaveBeenCalledWith(2)
    expect(useStore.getState().currentAudioTrack).toBe('mpv-a:2')
  })

  it('turns off a subtitle mpv picked on its own when the setting says off', async () => {
    useStore.getState().updateSettings({ defaultSubtitleEnabled: false })
    act(() => useStore.getState().playChannel(film))
    renderHook(() => useMpvPlayer(true))
    vi.mocked(mpvSetSubtitleTrack).mockClear()
    await push(playing({ tracks: loadedTracks, aid: 1, sid: 1 }))

    expect(vi.mocked(mpvSetSubtitleTrack)).toHaveBeenCalledWith(null)
    expect(useStore.getState().currentSubtitleTrack).toBeNull()
  })
})
