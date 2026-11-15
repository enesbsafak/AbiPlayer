import Hls from 'hls.js'
import { describe, expect, it, vi } from 'vitest'
import {
  HLS_MANIFEST_ERROR_DETAILS,
  HLS_MEDIA_ERROR,
  HLS_NETWORK_ERROR,
  isHlsJsSupported,
  startHlsEngine,
  type HlsEngineEvents,
  type HlsModuleLoader
} from './hls-engine'

const networkErrorData = { type: Hls.ErrorTypes.NETWORK_ERROR, details: Hls.ErrorDetails.FRAG_LOAD_ERROR }
const manifestErrorData = { type: Hls.ErrorTypes.NETWORK_ERROR, details: Hls.ErrorDetails.MANIFEST_LOAD_ERROR }

const noEvents: HlsEngineEvents = {
  manifestParsed: () => undefined,
  levelsChanged: () => undefined,
  audioTracksChanged: () => undefined,
  audioTrackSwitched: () => undefined,
  subtitleTracksChanged: () => undefined,
  subtitleTrackSwitched: () => undefined,
  failed: () => undefined
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** A stand-in for the hls.js class that records what was done with it. */
function fakeHlsModule() {
  const created: Array<{ loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn> }> = []
  class FakeHls {
    static Events = Hls.Events
    loadSource = vi.fn()
    attachMedia = vi.fn()
    on = vi.fn()
    destroy = vi.fn()
    constructor() {
      created.push(this)
    }
  }
  return { module: { default: FakeHls as unknown as typeof Hls }, created }
}

describe('hls-engine without hls.js loaded', () => {
  it('uses hls.js’s own error strings', () => {
    expect(HLS_NETWORK_ERROR).toBe(Hls.ErrorTypes.NETWORK_ERROR)
    expect(HLS_MEDIA_ERROR).toBe(Hls.ErrorTypes.MEDIA_ERROR)
    expect([...HLS_MANIFEST_ERROR_DETAILS].sort()).toEqual(
      [Hls.ErrorDetails.MANIFEST_LOAD_ERROR, Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT, Hls.ErrorDetails.MANIFEST_PARSING_ERROR].sort()
    )
  })

  it('answers "is hls.js supported" from Media Source Extensions, like Hls.isSupported()', () => {
    class SourceBuffer {
      appendBuffer() {}
      remove() {}
    }
    const supporting = { MediaSource: { isTypeSupported: (type: string) => type === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' }, SourceBuffer }
    expect(isHlsJsSupported(supporting)).toBe(true)
    expect(isHlsJsSupported({})).toBe(false)
    expect(isHlsJsSupported({ MediaSource: { isTypeSupported: () => false }, SourceBuffer })).toBe(false)
    expect(isHlsJsSupported({ MediaSource: { isTypeSupported: () => true }, SourceBuffer: { prototype: {} } })).toBe(false)
    // jsdom has no MSE: same answer as hls.js gives here.
    expect(isHlsJsSupported()).toBe(Hls.isSupported())
  })
})

describe('startHlsEngine', () => {
  it('creates nothing when the playback ends while hls.js is being loaded', async () => {
    const gate = deferred<{ default: typeof Hls }>()
    const fake = fakeHlsModule()
    const load: HlsModuleLoader = () => gate.promise
    const abort = new AbortController()
    const video = document.createElement('video')

    const starting = startHlsEngine(video, 'http://p.test/live/u/p/1.m3u8', noEvents, { signal: abort.signal, load })
    abort.abort()
    gate.resolve(fake.module)

    await expect(starting).resolves.toBeNull()
    expect(fake.created).toHaveLength(0)
  })

  it('attaches hls.js once it has loaded and the playback is still current', async () => {
    const fake = fakeHlsModule()
    const video = document.createElement('video')
    const engine = await startHlsEngine(video, 'http://p.test/live/u/p/1.m3u8', noEvents, {
      signal: new AbortController().signal,
      load: () => Promise.resolve(fake.module)
    })
    expect(engine).not.toBeNull()
    expect(fake.created).toHaveLength(1)
    expect(fake.created[0]?.loadSource).toHaveBeenCalledWith('http://p.test/live/u/p/1.m3u8')
    expect(fake.created[0]?.attachMedia).toHaveBeenCalledWith(video)
    engine?.dispose()
  })

  it('reloads the playlist on a reconnect, also after a fatal manifest failure (P1)', async () => {
    vi.useFakeTimers()
    const handlers = new Map<string, (event: string, data: unknown) => void>()
    class EventfulHls {
      static Events = Hls.Events
      loadSource = vi.fn()
      attachMedia = vi.fn()
      startLoad = vi.fn()
      destroy = vi.fn()
      on(event: string, handler: (event: string, data: unknown) => void) {
        handlers.set(event, handler)
      }
    }
    const clearTimeout = vi.spyOn(window, 'clearTimeout')
    const engine = await startHlsEngine(document.createElement('video'), 'http://p.test/live/u/p/1.m3u8', noEvents, {
      signal: new AbortController().signal,
      load: () => Promise.resolve({ default: EventfulHls as unknown as typeof Hls })
    })
    const hls = engine!.hls as unknown as EventfulHls

    // hls.js's own retry after a fragment failure fires and is forgotten.
    handlers.get(Hls.Events.ERROR)!(Hls.Events.ERROR, { fatal: true, ...networkErrorData })
    await vi.advanceTimersByTimeAsync(1000)
    expect(hls.startLoad).toHaveBeenCalledTimes(1)

    handlers.get(Hls.Events.ERROR)!(Hls.Events.ERROR, { fatal: true, ...manifestErrorData })
    engine!.reload()
    expect(hls.loadSource).toHaveBeenCalledTimes(2)
    expect(hls.loadSource).toHaveBeenLastCalledWith('http://p.test/live/u/p/1.m3u8')
    // The manifest retry belonged to the replaced load: cancelled, never run.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(hls.loadSource).toHaveBeenCalledTimes(2)

    clearTimeout.mockClear()
    engine!.dispose()
    // Nothing fired or cancelled is still held.
    expect(clearTimeout).not.toHaveBeenCalled()
    clearTimeout.mockRestore()
    vi.useRealTimers()
  })

  it('does not even load hls.js for a playback that is already over', async () => {
    const load = vi.fn<HlsModuleLoader>()
    const abort = new AbortController()
    abort.abort()
    await expect(
      startHlsEngine(document.createElement('video'), 'http://p.test/1.m3u8', noEvents, { signal: abort.signal, load })
    ).resolves.toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
