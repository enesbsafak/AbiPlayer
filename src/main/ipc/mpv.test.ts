// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { IpcInvokeChannel } from '../../shared/ipc/contract'
import type { MpvStateSnapshot } from '../../shared/types/electron-ipc'
import {
  MpvStateSubscriptions,
  SUBTITLE_NOT_PICKED_MESSAGE,
  createMpvPrewarmTrigger,
  maskSnapshotError,
  parseMpvOpenRequest,
  registerMpvHandlers,
  type MpvControllerApi,
  type MpvStateSubscriber
} from './mpv'
import type { IpcHandler } from './register'
import {
  clampNormalizedVolume,
  isValidMpvSubtitleStyle,
  isValidMpvTrackId,
  isValidPlaybackTuning,
  isValidStreamUrl
} from './validators'

type AnyHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function setup(pickedPaths: string[] = []) {
  const handlers = new Map<string, AnyHandler>()
  const controller = {
    addSubtitleFile: vi.fn().mockResolvedValue(4),
    setVolume: vi.fn().mockResolvedValue(undefined),
    seekTo: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined)
  }
  registerMpvHandlers(
    {
      handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>) {
        handlers.set(channel, handler as unknown as AnyHandler)
      }
    },
    {
      controller: controller as unknown as MpvControllerApi,
      registry: { wasPickedThisSession: (path: string) => pickedPaths.includes(path) },
      getWindow: () => null
    }
  )
  const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent
  const call = async (channel: IpcInvokeChannel, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return { controller, call, handlers }
}

describe('mpv handlers', () => {
  // F3-06: the renderer could hand mpv any local path.
  it('adds only subtitle files picked through our dialog in this session', async () => {
    const { controller, call } = setup(['C:\\Altyazi\\film.srt'])

    await expect(call('mpv-add-subtitle-file', 'C:\\Windows\\win.ini')).rejects.toThrow(SUBTITLE_NOT_PICKED_MESSAGE)
    expect(controller.addSubtitleFile).not.toHaveBeenCalled()

    await expect(call('mpv-add-subtitle-file', 'C:\\Altyazi\\film.srt')).resolves.toBe(4)
    expect(controller.addSubtitleFile).toHaveBeenCalledWith('C:\\Altyazi\\film.srt')
  })

  it('validates arguments before reaching the controller', async () => {
    const { controller, call } = setup()
    await expect(call('mpv-seek-to', -1)).rejects.toThrow('Geçersiz hedef zaman')
    await expect(call('mpv-set-volume', 'loud')).rejects.toThrow('Geçersiz ses seviyesi')
    await call('mpv-set-volume', 0.456)
    expect(controller.setVolume).toHaveBeenCalledWith(46)
  })

  it('keeps the explicit pause channel registered', () => {
    expect(setup().handlers.has('mpv-set-pause')).toBe(true)
  })

  it('hands the renderer playback id and tuning to the controller', async () => {
    const { controller, call } = setup()
    const tuning = { audioDelay: 0.5, subDelay: 0, speed: 1, aspectRatio: 'auto' as const }

    await call('mpv-open', 'https://p.example/a.ts', { playbackId: 'pb-1', tuning })
    expect(controller.open).toHaveBeenLastCalledWith('https://p.example/a.ts', undefined, { playbackId: 'pb-1', tuning, fileOptions: {} })

    await call('mpv-open', 'https://p.example/a.ts', { playbackId: 'pb-1' })
    expect(controller.open).toHaveBeenLastCalledWith('https://p.example/a.ts', undefined, { playbackId: 'pb-1', fileOptions: {} })

    await expect(call('mpv-open', 'https://p.example/a.ts')).rejects.toThrow('Geçersiz oynatma isteği')
    expect(controller.open).toHaveBeenCalledTimes(2)
  })
})

describe('parseMpvOpenRequest', () => {
  it('requires a well-formed playback id and valid tuning', () => {
    expect(parseMpvOpenRequest({ playbackId: 'pb-a1-b2-3' })).toEqual({ playbackId: 'pb-a1-b2-3' })
    expect(() => parseMpvOpenRequest({ playbackId: '' })).toThrow('Geçersiz oynatma kimliği')
    expect(() => parseMpvOpenRequest({ playbackId: 'a b' })).toThrow('Geçersiz oynatma kimliği')
    expect(() => parseMpvOpenRequest({ playbackId: 'x'.repeat(129) })).toThrow('Geçersiz oynatma kimliği')
    expect(() =>
      parseMpvOpenRequest({ playbackId: 'pb', tuning: { audioDelay: 99, subDelay: 0, speed: 1, aspectRatio: 'auto' } })
    ).toThrow('Geçersiz oynatma ayar verisi')
  })
})

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

function fakeController(initial: MpvStateSnapshot) {
  let state = initial
  const listeners = new Set<(snapshot: MpvStateSnapshot) => void>()
  return {
    listeners,
    getState: () => state,
    subscribe: vi.fn((listener: (snapshot: MpvStateSnapshot) => void) => {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }),
    emit(next: MpvStateSnapshot) {
      state = next
      for (const listener of listeners) listener(next)
    }
  }
}

function fakeWindow(id: number) {
  const destroyedListeners = new Set<() => void>()
  const sent: Array<[string, unknown]> = []
  let destroyed = false
  const target: MpvStateSubscriber = {
    id,
    isDestroyed: () => destroyed,
    send: (channel: string, payload: unknown) => sent.push([channel, payload]),
    once: (_event, listener) => destroyedListeners.add(listener),
    removeListener: (_event, listener) => destroyedListeners.delete(listener)
  }
  return {
    target,
    sent,
    destroyedListeners,
    destroy() {
      destroyed = true
      for (const listener of [...destroyedListeners]) listener()
    }
  }
}

describe('MpvStateSubscriptions', () => {
  it('returns the current snapshot and pushes every later one, credentials masked', () => {
    const controller = fakeController(snapshot({ seq: 4 }))
    const subscriptions = new MpvStateSubscriptions(controller)
    const window = fakeWindow(1)

    expect(subscriptions.subscribe(window.target)).toMatchObject({ seq: 4 })
    controller.emit(snapshot({ seq: 5, error: 'http://p.example/live/ali/s3cret/1.ts: 403' }))

    expect(window.sent.at(-1)).toEqual([
      'mpv-state',
      expect.objectContaining({ seq: 5, error: 'http://p.example/live/***/***/1.ts: 403' })
    ])
  })

  it('keeps one subscription per window across repeated subscribes (a renderer reload)', () => {
    const controller = fakeController(snapshot({ seq: 1, timePos: 40 }))
    const subscriptions = new MpvStateSubscriptions(controller)
    const window = fakeWindow(1)

    subscriptions.subscribe(window.target)
    controller.emit(snapshot({ seq: 2, timePos: 42 }))
    // The reloaded page subscribes again and is handed the full current state.
    expect(subscriptions.subscribe(window.target)).toMatchObject({ seq: 2, timePos: 42 })
    expect(controller.subscribe).toHaveBeenCalledTimes(1)
    expect(window.destroyedListeners.size).toBe(1)
  })

  it('ends the subscription on unsubscribe and when the window goes away', () => {
    const controller = fakeController(snapshot())
    const subscriptions = new MpvStateSubscriptions(controller)
    const first = fakeWindow(1)
    const second = fakeWindow(2)

    subscriptions.subscribe(first.target)
    subscriptions.subscribe(second.target)
    subscriptions.unsubscribe(first.target)
    expect(first.destroyedListeners.size).toBe(0)
    second.destroy()

    expect(subscriptions.size).toBe(0)
    expect(controller.listeners.size).toBe(0)
  })
})

describe('createMpvPrewarmTrigger', () => {
  function trigger(options: { available?: boolean; windowId?: string | null } = {}) {
    const timers: Array<() => void> = []
    const controller = {
      isAvailable: vi.fn(async () => options.available ?? true),
      prewarm: vi.fn(async () => undefined)
    }
    const prewarm = createMpvPrewarmTrigger({
      controller,
      getWindowId: () => (options.windowId === undefined ? '100' : options.windowId),
      setTimer: (callback) => timers.push(callback)
    })
    const runTimers = async () => {
      for (const callback of timers.splice(0)) callback()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { controller, prewarm, timers, runTimers }
  }

  it('waits for both the window being shown and the page having loaded, in either order', async () => {
    const { controller, prewarm, timers, runTimers } = trigger()
    prewarm.pageLoaded()
    expect(timers).toHaveLength(0)
    prewarm.windowShown()
    expect(timers).toHaveLength(1)
    expect(controller.prewarm).not.toHaveBeenCalled()

    await runTimers()
    expect(controller.prewarm).toHaveBeenCalledWith('100')
  })

  it('runs again after a reload of the page', async () => {
    const { controller, prewarm, runTimers } = trigger()
    prewarm.windowShown()
    prewarm.pageLoaded()
    await runTimers()
    prewarm.pageLoaded()
    await runTimers()
    expect(controller.prewarm).toHaveBeenCalledTimes(2)
  })

  it('is skipped without an mpv binary or a window handle', async () => {
    const missing = trigger({ available: false })
    missing.prewarm.windowShown()
    missing.prewarm.pageLoaded()
    await missing.runTimers()
    expect(missing.controller.prewarm).not.toHaveBeenCalled()

    const noHandle = trigger({ windowId: null })
    noHandle.prewarm.windowShown()
    noHandle.prewarm.pageLoaded()
    await noHandle.runTimers()
    expect(noHandle.controller.prewarm).not.toHaveBeenCalled()
  })
})

describe('maskSnapshotError', () => {
  it('masks credentials in the mpv error text only', () => {
    const state = snapshot({
      error: 'http://p.example/live/ali/s3cret/1.ts: 403',
      path: 'http://p.example/live/ali/s3cret/1.ts'
    })
    expect(maskSnapshotError(state)).toEqual({ ...state, error: 'http://p.example/live/***/***/1.ts: 403' })
    const clean = snapshot()
    expect(maskSnapshotError(clean)).toBe(clean)
  })
})

describe('validators', () => {
  it('accepts only http(s) stream URLs', () => {
    expect(isValidStreamUrl('https://p.example/a.m3u8')).toBe(true)
    expect(isValidStreamUrl('file:///C:/a.mkv')).toBe(false)
    expect(isValidStreamUrl(`https://p.example/${'a'.repeat(5000)}`)).toBe(false)
  })

  it('checks track ids, volume, style and tuning', () => {
    expect(isValidMpvTrackId(null)).toBe(true)
    expect(isValidMpvTrackId(0)).toBe(false)
    expect(isValidMpvTrackId(1.5)).toBe(false)
    expect(clampNormalizedVolume(2)).toBe(100)
    expect(isValidMpvSubtitleStyle({ fontSize: 40, color: '#fff', background: 'none' })).toBe(true)
    expect(isValidMpvSubtitleStyle({ fontSize: 40, color: '', background: 'none' })).toBe(false)
    expect(isValidPlaybackTuning({ audioDelay: 0, subDelay: 0, speed: 1, aspectRatio: '16:9' })).toBe(true)
    expect(isValidPlaybackTuning({ audioDelay: 11, subDelay: 0, speed: 1, aspectRatio: 'auto' })).toBe(false)
    expect(isValidPlaybackTuning({ audioDelay: 0, subDelay: 0, speed: 1, aspectRatio: '21:9' })).toBe(false)
  })
})

describe('mpv-open and the TLS policy (F3-01)', () => {
  function setupWithTls(mpvLoadOptions: (url: string) => Promise<Record<string, string>>) {
    const handlers = new Map<string, AnyHandler>()
    const controller = { open: vi.fn().mockResolvedValue(undefined), stopPlayback: vi.fn().mockResolvedValue(undefined) }
    registerMpvHandlers(
      {
        handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>) {
          handlers.set(channel, handler as unknown as AnyHandler)
        }
      },
      {
        controller: controller as unknown as MpvControllerApi,
        registry: { wasPickedThisSession: () => false },
        getWindow: () => null,
        tls: { mpvLoadOptions }
      }
    )
    const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent
    return {
      controller,
      open: (url: string) => handlers.get('mpv-open')!(event, url, { playbackId: 'pb-tls' }),
      stop: () => handlers.get('mpv-stop')!(event)
    }
  }

  it('hands the per-load TLS options to the controller', async () => {
    const { controller, open } = setupWithTls(async () => ({ 'tls-verify': 'no' }))
    await open('https://panel.example/movie/u/p/1.mp4')
    expect(controller.open).toHaveBeenCalledWith('https://panel.example/movie/u/p/1.mp4', undefined, {
      playbackId: 'pb-tls',
      fileOptions: { 'tls-verify': 'no' }
    })
  })

  it('lets a newer open or a stop win over an open still being checked', async () => {
    const pending: Array<(options: Record<string, string>) => void> = []
    const { controller, open, stop } = setupWithTls(
      () => new Promise<Record<string, string>>((resolve) => pending.push(resolve))
    )
    const first = open('https://panel.example/live/u/p/1.ts')
    const second = open('https://panel.example/live/u/p/2.ts')
    pending[1]({ 'tls-verify': 'yes' })
    await second
    pending[0]({ 'tls-verify': 'no' })
    await first
    expect(controller.open).toHaveBeenCalledTimes(1)
    expect(controller.open.mock.calls[0][0]).toBe('https://panel.example/live/u/p/2.ts')

    const third = open('https://panel.example/live/u/p/3.ts')
    await stop()
    pending[2]({})
    await third
    expect(controller.open).toHaveBeenCalledTimes(1)
  })

  it('does not open a stream the policy refuses', async () => {
    const { controller, open } = setupWithTls(async () => {
      throw new Error('Sunucunun güvenlik sertifikası değişti')
    })
    await expect(open('https://panel.example/movie/u/p/1.mp4')).rejects.toThrow('sertifika')
    expect(controller.open).not.toHaveBeenCalled()
  })
})
