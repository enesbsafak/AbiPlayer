import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Hls from 'hls.js'
import { itemAt } from '../../../shared/checked'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'
import { STALL_THRESHOLD_MS, reconnectDelayMs } from '@/player/reconnect-policy'

// The HTML5 engine with a stand-in for hls.js that records what the player
// asks of it and lets the test fire its events.
const fake = vi.hoisted(() => ({ created: [] as FakeHlsInstance[] }))

interface FakeHlsInstance {
  loadSource: ReturnType<typeof vi.fn>
  startLoad: ReturnType<typeof vi.fn>
  stopLoad: ReturnType<typeof vi.fn>
  audioTracks: Array<{ name: string; lang: string; default: boolean }>
  audioTrack: number
  emit(event: string): void
}

const EVENTS = {
  MANIFEST_LOADING: 'hlsManifestLoading',
  MANIFEST_PARSED: 'hlsManifestParsed',
  LEVELS_UPDATED: 'hlsLevelsUpdated',
  LEVEL_SWITCHED: 'hlsLevelSwitched',
  AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
  AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched',
  SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
  SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
  FRAG_BUFFERED: 'hlsFragBuffered',
  ERROR: 'hlsError'
}

class FakeHls implements FakeHlsInstance {
  static Events = EVENTS
  private readonly handlers = new Map<string, Array<() => void>>()
  loadSource = vi.fn()
  startLoad = vi.fn()
  stopLoad = vi.fn()
  attachMedia = vi.fn()
  destroy = vi.fn()
  audioTracks = [
    { name: 'Türkçe', lang: 'tr', default: true },
    { name: 'English', lang: 'en', default: false }
  ]
  audioTrack = 0
  subtitleTracks = []
  subtitleTrack = -1
  levels = []
  currentLevel = -1
  autoLevelEnabled = true
  nextLevel = -1
  constructor() {
    fake.created.push(this)
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler()
  }
}

vi.mock('@/player/hls-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/player/hls-engine')>()
  return {
    ...actual,
    startHlsEngine: (...[video, url, events, options]: Parameters<typeof actual.startHlsEngine>) =>
      actual.startHlsEngine(video, url, events, {
        ...options,
        load: () => Promise.resolve({ default: FakeHls as unknown as typeof Hls })
      })
  }
})

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    probeEmbeddedSubtitles: vi.fn(() => Promise.resolve([])),
    cancelMediaJob: vi.fn(() => Promise.resolve(true)),
    cancelAllMediaJobs: vi.fn(() => Promise.resolve(true))
  }
})

import { usePlayer } from './usePlayer'

function liveChannel(id: string): Channel {
  return { id, name: id, streamUrl: `https://iptv.test/${id}/index.m3u8`, sourceId: 'm3u', type: 'live' }
}

function film(id: string): Channel {
  return { id, name: id, streamUrl: `https://iptv.test/films/${id}.mp4`, sourceId: 'src', type: 'vod' }
}

/** A `<video>` that is playing, with a position the test moves. */
function playingVideo() {
  const video = document.createElement('video')
  let time = 0
  Object.defineProperty(video, 'paused', { get: () => false, configurable: true })
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: (value: number) => {
      time = value
    },
    configurable: true
  })
  return {
    video,
    advance(seconds: number) {
      time += seconds
      video.dispatchEvent(new Event('timeupdate'))
    }
  }
}

/** Native audio tracks as Chromium exposes them (`enabled`, one at a time). */
function withNativeAudioTracks(video: HTMLVideoElement) {
  const tracks = [
    { label: 'Türkçe', language: 'tr', enabled: true },
    { label: 'English', language: 'en', enabled: false }
  ]
  const list = Object.assign(tracks, { addEventListener: () => undefined, removeEventListener: () => undefined })
  Object.defineProperty(video, 'audioTracks', { get: () => list, configurable: true })
  return {
    tracks,
    /** A new source: the element starts on its default track again. */
    reset() {
      itemAt(tracks, 0).enabled = true
      itemAt(tracks, 1).enabled = false
    }
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  class SourceBuffer {
    appendBuffer() {}
    remove() {}
  }
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  vi.stubGlobal('SourceBuffer', SourceBuffer)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  fake.created.length = 0
  useStore.getState().stopPlayback()
})

afterEach(() => {
  cleanup()
  useStore.getState().stopPlayback()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('usePlayer live reconnect with hls.js (P1)', () => {
  it('fetches the playlist again when a live stream freezes, instead of only restarting the load', async () => {
    vi.useFakeTimers()
    const element = playingVideo()
    act(() => useStore.getState().playChannel(liveChannel('a')))
    const videoRef = { current: element.video }
    renderHook(() => usePlayer(videoRef))
    await flush()
    const hls = itemAt(fake.created, 0)
    expect(hls.loadSource).toHaveBeenCalledTimes(1)
    act(() => hls.emit(EVENTS.MANIFEST_PARSED))

    // Plays a little, then freezes: Chromium sends nothing more.
    for (let i = 0; i < 8; i += 1) {
      act(() => element.advance(0.25))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1 + reconnectDelayMs(1))
    })

    expect(hls.loadSource).toHaveBeenCalledTimes(2)
    expect(hls.loadSource).toHaveBeenLastCalledWith('https://iptv.test/a/index.m3u8')
    expect(hls.startLoad).not.toHaveBeenCalled()
    // The same hls.js instance: a reconnect is not a new playback.
    expect(fake.created).toHaveLength(1)
  })
})

describe('usePlayer keeps the viewer’s audio choice on a new load (P2)', () => {
  it('puts the chosen hls.js audio track back after "Yeniden Bağlan"', async () => {
    const element = playingVideo()
    act(() => useStore.getState().playChannel(liveChannel('a')))
    const videoRef = { current: element.video }
    renderHook(() => usePlayer(videoRef))
    await flush()
    act(() => itemAt(fake.created, 0).emit(EVENTS.MANIFEST_PARSED))
    expect(useStore.getState().currentAudioTrack).toBe('hls-a:0')

    act(() => useStore.getState().setCurrentAudioTrack('hls-a:1'))
    expect(fake.created[0]?.audioTrack).toBe(1)

    act(() => useStore.getState().reloadPlayback())
    await flush()
    const reloaded = itemAt(fake.created, 1)
    expect(reloaded.audioTrack).toBe(0)
    // hls.js settles on the stream's default before the manifest is reported.
    act(() => reloaded.emit(EVENTS.AUDIO_TRACK_SWITCHED))
    act(() => reloaded.emit(EVENTS.MANIFEST_PARSED))
    act(() => reloaded.emit(EVENTS.AUDIO_TRACK_SWITCHED))

    expect(reloaded.audioTrack).toBe(1)
    expect(useStore.getState().currentAudioTrack).toBe('hls-a:1')
  })

  it('puts the chosen audio track of a direct file back after a reload', async () => {
    vi.useFakeTimers()
    const element = playingVideo()
    const audio = withNativeAudioTracks(element.video)
    act(() => useStore.getState().playChannel(film('a')))
    const videoRef = { current: element.video }
    renderHook(() => usePlayer(videoRef))
    await flush()
    act(() => {
      element.video.dispatchEvent(new Event('loadedmetadata'))
    })
    act(() => useStore.getState().setCurrentAudioTrack('native-a:1'))
    expect(audio.tracks[1]?.enabled).toBe(true)

    act(() => useStore.getState().reloadPlayback())
    await flush()
    audio.reset()
    act(() => {
      element.video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(useStore.getState().currentAudioTrack).toBe('native-a:1')
    expect(audio.tracks.map((track) => track.enabled)).toEqual([false, true])
  })

  it('puts the chosen audio track and the loaded subtitle file back after a return from the mini card (P6)', async () => {
    const element = playingVideo()
    const audio = withNativeAudioTracks(element.video)
    const videoRef = { current: element.video }
    act(() => useStore.getState().playChannel(film('a')))
    const first = renderHook(() => usePlayer(videoRef))
    await flush()
    act(() => {
      element.video.dispatchEvent(new Event('loadedmetadata'))
    })
    const cues = [{ startTime: 1, endTime: 2, text: 'Merhaba' }]
    act(() => {
      useStore.getState().setCurrentAudioTrack('native-a:1')
      useStore.getState().applyPlayerPatch({ subtitleCues: cues })
      useStore.getState().selectSubtitleTrack('external')
    })

    first.unmount()
    act(() => useStore.getState().suspendPlayback())
    act(() => useStore.getState().resumeSuspendedPlayback())
    audio.reset()
    renderHook(() => usePlayer(videoRef))
    await flush()
    act(() => {
      element.video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(audio.tracks.map((track) => track.enabled)).toEqual([false, true])
    expect(useStore.getState().currentSubtitleTrack).toBe('external')
    expect(useStore.getState().subtitleCues).toEqual(cues)
  })

  it('puts it back after the direct-read retry of the same playback', async () => {
    const element = playingVideo()
    const audio = withNativeAudioTracks(element.video)
    act(() => useStore.getState().playChannel(film('a')))
    const videoRef = { current: element.video }
    renderHook(() => usePlayer(videoRef))
    await flush()
    act(() => {
      element.video.dispatchEvent(new Event('loadedmetadata'))
    })
    act(() => useStore.getState().setCurrentAudioTrack('native-a:1'))

    Object.defineProperty(element.video, 'error', {
      get: () => ({ message: 'PIPELINE_ERROR_READ: FFmpegDemuxer: data source error' }),
      configurable: true
    })
    act(() => {
      element.video.dispatchEvent(new Event('error'))
    })
    audio.reset()
    act(() => {
      element.video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(audio.tracks.map((track) => track.enabled)).toEqual([false, true])
  })
})
