import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Hls from 'hls.js'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

// hls.js is loaded on demand when the HTML5 engine starts HLS (plan F5-07).
// Here the real engine start runs with its module load held at a gate the
// test opens, so a playback can end while hls.js is still "loading".
const hlsModule = vi.hoisted(() => {
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open: () => open(), created: [] as Array<{ url: string | null; destroyed: boolean }> }
})

class FakeHls {
  static Events = {
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
  private readonly record = { url: null as string | null, destroyed: false }
  constructor() {
    hlsModule.created.push(this.record)
  }
  loadSource(url: string) {
    this.record.url = url
  }
  attachMedia() {}
  on() {}
  destroy() {
    this.record.destroyed = true
  }
}

vi.mock('@/player/hls-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/player/hls-engine')>()
  return {
    ...actual,
    startHlsEngine: (...[video, url, events, options]: Parameters<typeof actual.startHlsEngine>) =>
      actual.startHlsEngine(video, url, events, {
        ...options,
        load: () => hlsModule.gate.then(() => ({ default: FakeHls as unknown as typeof Hls }))
      })
  }
})

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return { ...actual, cancelAllMediaJobs: vi.fn(() => Promise.resolve(true)) }
})

import { usePlayer } from './usePlayer'

function channel(id: string): Channel {
  return { id, name: id, streamUrl: `https://iptv.test/${id}/index.m3u8`, sourceId: 'm3u', type: 'live' }
}

/** Lets the opened gate and the promise chains after it run. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

describe('usePlayer loading hls.js on demand', () => {
  beforeEach(() => {
    class SourceBuffer {
      appendBuffer() {}
      remove() {}
    }
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    vi.stubGlobal('SourceBuffer', SourceBuffer)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    useStore.getState().stopPlayback()
  })

  afterEach(() => {
    cleanup()
    useStore.getState().stopPlayback()
    vi.unstubAllGlobals()
  })

  it('starts nothing for a playback that changed or a player that went away before hls.js arrived', async () => {
    const videoRef = { current: document.createElement('video') }

    act(() => useStore.getState().playChannel(channel('a')))
    const first = renderHook(() => usePlayer(videoRef))
    // Another channel while hls.js is still loading...
    act(() => useStore.getState().playChannel(channel('b')))
    // ...and a second player that unmounts before it arrives.
    const otherRef = { current: document.createElement('video') }
    const second = renderHook(() => usePlayer(otherRef))
    second.unmount()

    hlsModule.open()
    await flush()

    // Only the playback still current with a mounted player got an engine.
    expect(hlsModule.created).toEqual([{ url: 'https://iptv.test/b/index.m3u8', destroyed: false }])

    first.unmount()
    expect(hlsModule.created[0].destroyed).toBe(true)
  })
})
