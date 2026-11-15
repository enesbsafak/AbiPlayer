// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MpvIdentifiedSnapshot } from '../shared/types/electron-ipc'
import { MpvController, MPV_PASSTHROUGH_SETTLE_MS, type MpvControllerDeps } from './mpv-controller'
import { MPV_UNEXPECTED_EXIT_MESSAGE } from './mpv/session'
import { FakeMpv, type FakeMpvProcess } from './mpv/testing/fake-mpv'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const URL_A = 'http://iptv.test/a.ts'
const URL_B = 'http://iptv.test/b.ts'
const URL_C = 'http://iptv.test/c.ts'

function setup(overrides: Partial<MpvControllerDeps> = {}) {
  const mpv = new FakeMpv()
  let pipe = 0
  const controller = new MpvController({
    resolveBinary: () => '/fake/mpv',
    spawn: mpv.spawn,
    connect: mpv.connect,
    createSocketPath: () => `fake-pipe-${++pipe}`,
    removeSocketFile: undefined,
    ...overrides
  })
  return { mpv, controller }
}

/** Lets queued replies and promise chains run without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

function loadfiles(fake: FakeMpvProcess): unknown[] {
  return fake.commands('loadfile').map((command) => command[1])
}

function propertyWrites(fake: FakeMpvProcess, name: string): unknown[] {
  return fake
    .setProperties()
    .filter(([key]) => key === name)
    .map(([, value]) => value)
}

/** Opens `url` in a fresh session and drives mpv until the file plays. */
async function play(controller: MpvController, mpv: FakeMpv, url: string, playbackId?: string) {
  await controller.open(url, '100', playbackId ? { playbackId } : {})
  const fake = mpv.last
  fake.startFile()
  fake.fileLoaded()
  await settle()
  return fake
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MpvController start-up and teardown', () => {
  it('reports availability without starting a process, and does not cache a miss', async () => {
    let binary: string | null = null
    const { mpv, controller } = setup({ resolveBinary: () => binary })

    expect(await controller.isAvailable()).toBe(false)
    await expect(controller.open(URL_A, '100')).rejects.toThrow('mpv ikili dosyası bulunamadı')
    expect(controller.getState().phase).toBe('error')

    binary = '/fake/mpv'
    expect(await controller.isAvailable()).toBe(true)
    expect(mpv.processes).toHaveLength(0)
    await controller.open(URL_A, '100')
    expect(controller.getState().available).toBe(true)
    expect(loadfiles(mpv.last)).toEqual([URL_A])
  })

  it('launches with isolation flags and never with audio-spdif', async () => {
    const { mpv, controller } = setup()
    await controller.setAudioPassthrough(true)
    await controller.open(URL_A, '100')

    const args = mpv.last.args
    expect(args).toEqual(expect.arrayContaining(['--no-config', '--load-scripts=no', '--ytdl=no']))
    expect(args.some((arg) => arg.startsWith('--audio-spdif'))).toBe(false)
    expect(args).toContain('--wid=100')
  })

  it('recovers from a connect timeout; the abandoned child is killed and cannot touch the next session', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => {
      if (mpv.processes.length === 1) {
        fake.listening = false
        fake.ignoresSignals = true
      }
    }

    const first = controller.open(URL_A, '100')
    const rejected = expect(first).rejects.toThrow('mpv IPC soketine bağlanılamadı')
    await vi.advanceTimersByTimeAsync(8000)
    await rejected
    const abandoned = mpv.processes[0]
    expect(abandoned.signals).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(2000)
    // The SIGKILL fallback actually runs (it used to be gated on `killed`).
    expect(abandoned.signals).toEqual(['SIGTERM', 'SIGKILL'])

    const second = await play(controller, mpv, URL_B)
    expect(controller.getState()).toMatchObject({ phase: 'playing', error: null, sessionId: 2 })

    // The wedged first child finally exits; that must not reach session 2.
    abandoned.exit(1)
    await settle()
    expect(controller.getState()).toMatchObject({ phase: 'playing', error: null, sessionId: 2 })
    expect(second.exited).toBe(false)
    expect(second.signals).toEqual([])
  })

  it('surfaces a crash during loadfile and starts cleanly afterwards', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => fake.holding.add('loadfile')

    const opened = controller.open(URL_A, '100', { playbackId: 'A' })
    const rejected = expect(opened).rejects.toThrow(MPV_UNEXPECTED_EXIT_MESSAGE)
    await settle()
    expect(mpv.last.commands('loadfile')).toHaveLength(1)
    mpv.last.exit(139)
    await rejected

    expect(controller.getState()).toMatchObject({
      phase: 'error',
      error: MPV_UNEXPECTED_EXIT_MESSAGE,
      playbackId: 'A',
      sessionId: null,
      running: false
    })

    mpv.onSpawn = () => undefined
    await play(controller, mpv, URL_B)
    expect(mpv.processes).toHaveLength(2)
    expect(controller.getState()).toMatchObject({ phase: 'playing', error: null })
  })

  it('surfaces an unexpected exit while playing as an error', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A, 'A')

    fake.exit(1)
    await settle()

    expect(controller.getState()).toMatchObject({
      phase: 'error',
      error: MPV_UNEXPECTED_EXIT_MESSAGE,
      running: false,
      sessionId: null,
      playbackId: 'A'
    })
  })

  it('treats the pipe closing before the process as a dead session and reaps the process', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)

    fake.peer?.hangUp()
    await settle()

    expect(controller.getState()).toMatchObject({ phase: 'error', error: MPV_UNEXPECTED_EXIT_MESSAGE })
    expect(fake.signals).toEqual(['SIGTERM'])
    expect(fake.exited).toBe(true)
  })

  it('does not wait two seconds for a process that already exited', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.exit(0)
    await settle()

    let done = false
    void controller.shutdown().then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(true)
  })

  it('shutdown waits for teardown to finish, even when called twice', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.holding.add('quit')
    fake.ignoresSignals = true

    let first = false
    let second = false
    void controller.shutdown().then(() => (first = true))
    void controller.shutdown().then(() => (second = true))
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.signals).toEqual(['SIGTERM'])
    expect(first || second).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(first && second).toBe(true)
  })

  it('a session dying under the commands sent ahead of loadfile leaves no unhandled rejection', async () => {
    const { mpv, controller } = setup()
    await controller.prewarm('100')
    const fake = mpv.last
    fake.holding.add('set_property')
    fake.holding.add('loadfile')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const opened = controller.open(URL_A, '100', {
        playbackId: 'A',
        tuning: { audioDelay: 0.5, subDelay: 0, speed: 1, aspectRatio: 'auto' }
      })
      const rejected = expect(opened).rejects.toThrow(MPV_UNEXPECTED_EXIT_MESSAGE)
      await settle()
      expect(fake.commands('set_property').map((command) => command[1])).toEqual(
        expect.arrayContaining(['pause', 'audio-delay'])
      )
      fake.exit(1)
      await rejected
      // Node reports unhandled rejections after the microtask queue drains.
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })

  it('kills every live process at once on exit, including a wedged one being torn down', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.holding.add('quit')
    fake.ignoresSignals = true
    void controller.shutdown()
    await settle()
    expect(fake.signals).toEqual([])

    controller.killProcessesNow()
    expect(fake.signals).toEqual(['SIGKILL'])
  })

  it('pre-warms one idle process that the first open reuses', async () => {
    const { mpv, controller } = setup()

    await controller.prewarm('100')
    await controller.prewarm('100')
    expect(mpv.processes).toHaveLength(1)
    expect(mpv.last.commands('loadfile')).toEqual([])
    expect(mpv.last.setProperties().some(([name]) => name === 'audio-spdif')).toBe(false)
    expect(controller.getState()).toMatchObject({ phase: 'idle', sessionId: 1, running: false })

    await controller.open(URL_A, '100')
    expect(mpv.processes).toHaveLength(1)
    expect(loadfiles(mpv.last)).toEqual([URL_A])
  })

  it('moves an idle pre-warmed process to a new window, but not after a stop', async () => {
    const { mpv, controller } = setup()
    await controller.prewarm('100')
    await controller.prewarm('200')
    expect(mpv.processes).toHaveLength(2)
    expect(mpv.processes[0].exited).toBe(true)
    expect(mpv.last.args).toContain('--wid=200')

    await controller.open(URL_A, '300')
    await controller.stopPlayback()
    await settle()
    // Stopping leaves the process idle where it is instead of re-spawning it
    // in the window the pre-warm once named.
    expect(mpv.processes).toHaveLength(3)
    expect(mpv.alive).toEqual([mpv.last])
    expect(mpv.last.commands('stop')).toHaveLength(1)
  })
})

describe('MpvController intent and reconciliation', () => {
  it('a stop issued during a cold start wins: nothing is loaded', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => (fake.listening = false)

    const opened = controller.open(URL_A, '100')
    await settle()
    await controller.stopPlayback()
    await expect(opened).resolves.toBeUndefined()

    mpv.last.listening = true
    await vi.advanceTimersByTimeAsync(150)
    await settle()

    expect(controller.getState()).toMatchObject({ phase: 'idle', sessionId: 1 })
    expect(mpv.last.commands('loadfile')).toEqual([])
  })

  it('applies tuning, margin, hardware decoding and volume set during a cold start', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => (fake.listening = false)

    const opened = controller.open(URL_A, '100')
    const tuning = { audioDelay: 0.3, subDelay: -1, speed: 1.25, aspectRatio: '16:9' as const }
    await Promise.all([
      controller.setPlaybackTuning(tuning),
      controller.setVideoMarginRatio(0.25),
      controller.setHardwareDecoding(false),
      controller.setVolume(40)
    ])

    mpv.last.listening = true
    await vi.advanceTimersByTimeAsync(150)
    await opened

    const fake = mpv.last
    const writes = new Map(fake.setProperties())
    expect(writes.get('audio-delay')).toBe(0.3)
    expect(writes.get('sub-delay')).toBe(-1)
    expect(writes.get('speed')).toBe(1.25)
    expect(writes.get('video-aspect-override')).toBe('16:9')
    expect(writes.get('video-margin-ratio-right')).toBe(0.25)
    expect(writes.get('volume')).toBe(40)
    // Either the launch argument already says so or it was set right after.
    expect(fake.args.includes('--hwdec=no') || writes.get('hwdec') === 'no').toBe(true)

    // Tuning reaches mpv before the file is opened.
    const order = fake.received.map((entry) => entry.command[0] === 'loadfile' ? 'loadfile' : entry.command[1])
    expect(order.indexOf('audio-delay')).toBeLessThan(order.indexOf('loadfile'))
  })

  it('re-applies every durable setting to a new process, but not another playback tuning', async () => {
    const { mpv, controller } = setup()
    const first = await play(controller, mpv, URL_A)
    await controller.setHardwareDecoding(false)
    await controller.setVolume(30)
    await controller.setMute(true)
    await controller.setVideoMarginRatio(0.2)
    await controller.setFullscreen(true)
    await controller.setSubtitleStyle({ fontSize: 48, color: '#ff0000', background: '#000' })
    await controller.setPlaybackTuning({ audioDelay: 1, subDelay: 0, speed: 1, aspectRatio: 'auto' })
    expect(propertyWrites(first, 'hwdec')).toEqual(['no'])

    first.exit(1)
    await settle()
    await controller.open(URL_B, '100')

    const second = mpv.last
    expect(second).not.toBe(first)
    const writes = new Map(second.setProperties())
    expect(second.args).toContain('--hwdec=no')
    expect(writes.get('volume')).toBe(30)
    expect(writes.get('mute')).toBe(true)
    expect(writes.get('video-margin-ratio-right')).toBe(0.2)
    expect(writes.get('fullscreen')).toBe(true)
    expect(writes.get('sub-color')).toBe('#FF0000')
    expect(writes.has('audio-delay')).toBe(false)
  })

  it('resets the previous load tuning when the next load brings none', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    await controller.setPlaybackTuning({ audioDelay: 0.5, subDelay: 0, speed: 2, aspectRatio: '4:3' })
    await controller.open(URL_B, '100')

    expect(propertyWrites(fake, 'audio-delay')).toEqual([0.5, 0])
    expect(propertyWrites(fake, 'speed')).toEqual([2, 1])
    expect(propertyWrites(fake, 'video-aspect-override')).toEqual(['4:3', -1])
  })

  it('keeps tuning across a reconnect and a process restart of the same playback', async () => {
    const { mpv, controller } = setup()
    const tuning = { audioDelay: 0.4, subDelay: 0, speed: 1, aspectRatio: '4:3' as const }
    await controller.open(URL_A, '100', { playbackId: 'A' })
    await controller.setPlaybackTuning(tuning)

    // Reconnect of the same playback in the same process: nothing to resend.
    await controller.open(URL_A, '100', { playbackId: 'A' })
    expect(propertyWrites(mpv.last, 'audio-delay')).toEqual([0.4])

    // mpv dies; the renderer reconnects the same playback in a new process.
    mpv.last.exit(1)
    await settle()
    await controller.open(URL_A, '100', { playbackId: 'A' })
    expect(mpv.processes).toHaveLength(2)
    expect(propertyWrites(mpv.last, 'audio-delay')).toEqual([0.4])
    expect(propertyWrites(mpv.last, 'video-aspect-override')).toEqual(['4:3'])

    // A different playback starts from defaults.
    await controller.open(URL_B, '100', { playbackId: 'B' })
    expect(propertyWrites(mpv.last, 'audio-delay')).toEqual([0.4, 0])
  })

  it('treats the same URL as the same playback when no playback id is given', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_A, '100')
    await controller.setPlaybackTuning({ audioDelay: 0, subDelay: 0, speed: 1.5, aspectRatio: 'auto' })
    await controller.open(URL_A, '100')
    expect(propertyWrites(mpv.last, 'speed')).toEqual([1.5])
    await controller.open(URL_B, '100')
    expect(propertyWrites(mpv.last, 'speed')).toEqual([1.5, 1])
  })

  it('starts exactly one new process when two opens follow a window change', async () => {
    const { mpv, controller } = setup()
    const original = await play(controller, mpv, URL_A)

    const b = controller.open(URL_B, '200')
    const c = controller.open(URL_C, '200')
    await Promise.all([b, c])

    expect(mpv.processes).toHaveLength(2)
    expect(original.commands('quit')).toHaveLength(1)
    expect(loadfiles(mpv.last)).toEqual([URL_C])
    expect(mpv.last.args).toContain('--wid=200')
  })

  it('does not hold up a new session while an old one is still being torn down', async () => {
    const { mpv, controller } = setup()
    const original = await play(controller, mpv, URL_A)
    original.holding.add('quit')
    original.ignoresSignals = true

    await controller.open(URL_B, '200')
    // No clock movement needed: the new process is up and loading already.
    expect(loadfiles(mpv.last)).toEqual([URL_B])
    expect(original.exited).toBe(false)
    expect(controller.getState().sessionId).toBe(2)

    // The old child finally exits while its replacement is playing.
    const replacement = mpv.last
    replacement.startFile()
    replacement.fileLoaded()
    await settle()
    original.exit(1)
    await settle()
    expect(controller.getState()).toMatchObject({ phase: 'playing', error: null, sessionId: 2 })
    expect(replacement.exited).toBe(false)
  })

  it('keeps the session when open is called without a window handle', async () => {
    const { mpv, controller } = setup()
    await play(controller, mpv, URL_A)
    await controller.open(URL_B)
    expect(mpv.processes).toHaveLength(1)
    expect(loadfiles(mpv.last)).toEqual([URL_A, URL_B])
  })
})

describe('MpvController per-stream state', () => {
  it('clears a property mpv reports without data', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.propertyChange('time-pos', 120)
    fake.propertyChange('duration', 3600)
    await settle()
    expect(controller.getState()).toMatchObject({ timePos: 120, duration: 3600 })

    fake.propertyChange('time-pos')
    fake.propertyChange('duration')
    await settle()
    expect(controller.getState()).toMatchObject({ timePos: 0, duration: 0 })
  })

  it('starts every load with empty per-stream state and ignores the old file meanwhile', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.propertyChange('time-pos', 500)
    fake.propertyChange('duration', 900)
    fake.propertyChange('track-list', [{ id: 1, type: 'audio', selected: true }])
    fake.propertyChange('aid', 1)
    await settle()

    const opened = controller.open(URL_B, '100')
    expect(controller.getState()).toMatchObject({
      phase: 'loading',
      timePos: 0,
      duration: 0,
      tracks: [],
      aid: null,
      path: null,
      error: null
    })
    await opened

    // The old file is still winding down before mpv starts the new one.
    fake.propertyChange('time-pos', 501)
    fake.endFile('stop', {}, 1)
    await settle()
    expect(controller.getState()).toMatchObject({ timePos: 0, error: null, phase: 'loading' })

    fake.startFile()
    fake.propertyChange('time-pos', 2)
    await settle()
    expect(controller.getState().timePos).toBe(2)
  })

  it('re-reads tracks after load so values equal to the previous file are not lost', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.properties.set('track-list', [{ id: 1, type: 'audio', selected: true }])
    fake.properties.set('aid', 1)

    await controller.open(URL_B, '100')
    fake.startFile()
    fake.fileLoaded()
    await settle()

    expect(controller.getState()).toMatchObject({ aid: 1, path: URL_B, phase: 'playing' })
    expect(controller.getState().tracks).toHaveLength(1)
  })

  it('keeps a fast load error: end-file before the next command reply', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_A, '100', { playbackId: 'A' })
    const fake = mpv.last
    fake.holding.add('set_property')

    const volume = controller.setVolume(50)
    fake.startFile()
    fake.endFile('error', { file_error: 'loading failed' })
    await settle()
    fake.release()
    await volume

    expect(controller.getState()).toMatchObject({
      phase: 'error',
      error: 'Yayın açılamadı. Kaynak yanıt vermiyor veya adres geçersiz.',
      playbackId: 'A',
      running: false
    })
  })

  it('attributes an error that arrives before the loadfile reply', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => fake.holding.add('loadfile')
    const opened = controller.open(URL_A, '100')
    await settle()

    const fake = mpv.last
    // Release the reply only after mpv already reported the failure.
    fake.holding.delete('loadfile')
    const held = fake.received.find((entry) => entry.command[0] === 'loadfile')
    fake.event({ event: 'start-file', playlist_entry_id: 1 })
    fake.event({ event: 'end-file', reason: 'error', playlist_entry_id: 1, file_error: 'http 403' })
    fake.reply(held?.requestId ?? -1, { data: { playlist_entry_id: 1 } })
    await opened

    expect(controller.getState()).toMatchObject({ phase: 'error', error: 'Yayın açılamadı: http 403' })
  })

  it('attributes events without a loadfile entry id to the next started file', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => (fake.replyEntryIds = false)
    const fake = await play(controller, mpv, URL_A)
    expect(controller.getState().phase).toBe('playing')

    await controller.open(URL_B, '100')
    fake.endFile('stop', {}, 1)
    fake.startFile(2)
    fake.endFile('error', { file_error: 'loading failed' }, 2)
    await settle()
    expect(controller.getState().phase).toBe('error')
  })

  it('ignores non-error ends of the previous file and never shows them as failures', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    await controller.open(URL_B, '100')
    for (const reason of ['stop', 'error']) fake.endFile(reason, { file_error: 'loading failed' }, 1)
    await settle()
    expect(controller.getState().error).toBeNull()
  })

  it('A, then B, then A again: only the last load counts', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_C, 'C')

    const first = controller.open(URL_A, '100', { playbackId: 'A' })
    const second = controller.open(URL_B, '100', { playbackId: 'B' })
    const third = controller.open(URL_A, '100', { playbackId: 'A' })
    await Promise.all([first, second, third])
    const loadId = controller.getState().loadId

    // B was superseded before it was ever sent; the first A was sent.
    expect(loadfiles(fake)).toEqual([URL_C, URL_A, URL_A])
    // The first A's entry starts, reports a position and fails.
    fake.startFile(2)
    fake.propertyChange('time-pos', 40)
    fake.endFile('error', { file_error: 'loading failed' }, 2)
    await settle()
    expect(controller.getState()).toMatchObject({
      playbackId: 'A',
      loadId,
      phase: 'loading',
      timePos: 0,
      error: null
    })

    fake.startFile(3)
    fake.propertyChange('time-pos', 1)
    fake.fileLoaded()
    await settle()
    expect(controller.getState()).toMatchObject({ playbackId: 'A', loadId, phase: 'playing', timePos: 1 })
  })

  it('follows a playlist redirect without losing the playback', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_A, '100', { playbackId: 'A' })
    const fake = mpv.last
    fake.startFile(1)
    fake.endFile('redirect', { playlist_insert_id: 7, playlist_insert_num_entries: 1 }, 1)
    // Nothing is attributed between the redirect and the new entry starting.
    fake.propertyChange('duration', 99)
    await settle()
    expect(controller.getState()).toMatchObject({ playbackId: 'A', phase: 'loading', duration: 0 })

    fake.startFile(7)
    fake.propertyChange('duration', 120)
    fake.fileLoaded()
    fake.endFile('error', { file_error: 'loading failed' }, 1)
    await settle()
    expect(controller.getState()).toMatchObject({
      playbackId: 'A',
      phase: 'playing',
      duration: 120,
      error: null
    })
    fake.endFile('error', { file_error: 'loading failed' }, 7)
    await settle()
    expect(controller.getState()).toMatchObject({ playbackId: 'A', phase: 'error' })
  })

  it('a loadfile that times out fails the load; its late reply changes nothing', async () => {
    const { mpv, controller } = setup()
    mpv.onSpawn = (fake) => fake.holding.add('loadfile')
    const opened = controller.open(URL_A, '100', { playbackId: 'A' })
    const rejected = expect(opened).rejects.toThrow('zaman aşımı')
    await settle()
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(controller.getState()).toMatchObject({ phase: 'error', playbackId: 'A' })

    const fake = mpv.last
    fake.holding.clear()
    fake.release()
    fake.startFile(1)
    fake.propertyChange('time-pos', 12)
    await settle()
    expect(controller.getState()).toMatchObject({ phase: 'error', timePos: 0 })

    await controller.open(URL_B, '100', { playbackId: 'B' })
    fake.startFile(2)
    fake.fileLoaded()
    await settle()
    expect(controller.getState()).toMatchObject({ phase: 'playing', playbackId: 'B', error: null })
    expect(mpv.processes).toHaveLength(1)
  })

  it('reports playing, then ended at end of file', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    expect(controller.getState()).toMatchObject({ phase: 'playing', running: true })
    fake.propertyChange('eof-reached', true)
    await settle()
    expect(controller.getState().phase).toBe('ended')
  })

  it('leaves track ids to the observer after a setter', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A)
    fake.propertyChange('aid', 2)
    await settle()

    await controller.setAudioTrack(null)
    expect(fake.commands('set_property').at(-1)).toEqual(['set_property', 'aid', 'auto'])
    // Before mpv reports its pick, the last observed value stands.
    expect(controller.getState().aid).toBe(2)
    fake.propertyChange('aid', 1)
    await settle()
    expect(controller.getState().aid).toBe(1)
  })

  it('jumps to the live edge as a fresh load of the same playback', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A, 'A')
    fake.propertyChange('time-pos', 50)
    await settle()

    await controller.jumpToLive()
    const last = fake.commands('loadfile').at(-1)
    expect(last).toEqual(['loadfile', URL_A, 'replace', -1, { 'demuxer-lavf-o': 'live_start_index=-1' }])
    expect(controller.getState()).toMatchObject({ playbackId: 'A', timePos: 0, phase: 'loading' })
  })
})

describe('MpvController snapshots', () => {
  it('gives a subscriber the current snapshot at once, then coalesces time updates', async () => {
    const { mpv, controller } = setup()
    const received: MpvIdentifiedSnapshot[] = []
    const unsubscribe = controller.subscribe((snapshot) => received.push(snapshot))
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ phase: 'idle', sessionId: null, playbackId: null })

    const fake = await play(controller, mpv, URL_A, 'A')
    const before = received.length
    for (let i = 1; i <= 20; i += 1) fake.propertyChange('time-pos', i)
    await settle()
    expect(received.length).toBe(before)
    await vi.advanceTimersByTimeAsync(200)
    expect(received.length).toBe(before + 1)
    expect(received.at(-1)?.timePos).toBe(20)

    // Lifecycle changes are pushed immediately.
    fake.endFile('error', { file_error: 'loading failed' })
    await settle()
    expect(received.at(-1)?.phase).toBe('error')

    unsubscribe()
    fake.propertyChange('time-pos', 99)
    await vi.advanceTimersByTimeAsync(500)
    expect(received.at(-1)?.timePos).not.toBe(99)
  })

  it('a re-subscriber mid-playback gets the full current snapshot', async () => {
    const { mpv, controller } = setup()
    const fake = await play(controller, mpv, URL_A, 'A')
    fake.propertyChange('time-pos', 42)
    fake.propertyChange('track-list', [{ id: 1, type: 'audio', selected: true }])
    await settle()

    const first: MpvIdentifiedSnapshot[] = []
    controller.subscribe((snapshot) => first.push(snapshot))()
    const again: MpvIdentifiedSnapshot[] = []
    controller.subscribe((snapshot) => again.push(snapshot))

    expect(again).toHaveLength(1)
    expect(again[0]).toEqual(controller.getState())
    expect(again[0]).toMatchObject({
      playbackId: 'A',
      sessionId: 1,
      phase: 'playing',
      timePos: 42,
      tracks: [expect.objectContaining({ id: 1, type: 'audio' })]
    })
    expect(again[0].seq).toBe(first[0].seq)
  })

  it('numbers snapshots monotonically and gives every load attempt its own loadId', async () => {
    const { mpv, controller } = setup()
    const received: MpvIdentifiedSnapshot[] = []
    controller.subscribe((snapshot) => received.push(snapshot))

    const fake = await play(controller, mpv, URL_A, 'A')
    const firstLoad = controller.getState().loadId
    fake.propertyChange('time-pos', 5)
    await vi.advanceTimersByTimeAsync(200)
    await controller.jumpToLive()
    const reload = controller.getState().loadId
    await controller.open(URL_A, '100', { playbackId: 'A' })
    const reconnect = controller.getState().loadId

    expect(firstLoad).not.toBeNull()
    expect(new Set([firstLoad, reload, reconnect]).size).toBe(3)
    expect(controller.getState().playbackId).toBe('A')
    const seqs = received.map((snapshot) => snapshot.seq)
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    // Unchanged state keeps its number.
    expect(controller.getState().seq).toBe(controller.getState().seq)
  })

  it('never emits a superseded playback as the current one', async () => {
    const { mpv, controller } = setup()
    const received: MpvIdentifiedSnapshot[] = []
    controller.subscribe((snapshot) => received.push(snapshot))

    const fake = await play(controller, mpv, URL_A, 'A')
    fake.propertyChange('time-pos', 300)
    fake.propertyChange('duration', 1000)
    await vi.advanceTimersByTimeAsync(200)

    const opened = controller.open(URL_B, '100', { playbackId: 'B' })
    // Stale traffic from A after B was requested.
    fake.propertyChange('time-pos', 301)
    fake.endFile('error', { file_error: 'loading failed' }, 1)
    await opened
    await vi.advanceTimersByTimeAsync(400)

    const forB = received.filter((snapshot) => snapshot.playbackId === 'B')
    expect(forB.length).toBeGreaterThan(0)
    for (const snapshot of forB) {
      expect(snapshot.timePos).toBe(0)
      expect(snapshot.duration).toBe(0)
      expect(snapshot.error).toBeNull()
    }
  })
})

describe('MpvController audio passthrough', () => {
  const CODECS = 'ac3,dts,eac3,truehd'

  async function playWithPassthrough(replies: Record<string, unknown>) {
    const { mpv, controller } = setup()
    await controller.setAudioPassthrough(true)
    mpv.onSpawn = (fake) => {
      for (const [key, value] of Object.entries(replies)) fake.properties.set(key, value)
    }
    const fake = await play(controller, mpv, URL_A)
    return { mpv, controller, fake }
  }

  it('waits for audio to start rather than a fixed delay after loadfile', async () => {
    const { controller, fake } = await playWithPassthrough({
      'audio-params/format': 'spdif-ac3',
      'current-ao': 'wasapi'
    })
    expect(propertyWrites(fake, 'audio-spdif')).toEqual([CODECS])

    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.commands('get_property').some((c) => c[1] === 'current-ao')).toBe(false)

    fake.playbackRestart()
    await settle()
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS)
    expect(controller.getState().passthroughActive).toBe(true)
  })

  it('restores PCM when the device refuses the bitstream', async () => {
    // mpv reports no error here — it just ends up with no audio output and
    // plays on silently, so the empty `current-ao` is the only tell.
    const { controller, fake } = await playWithPassthrough({ 'audio-params/format': 'spdif-ac3' })
    fake.playbackRestart()
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS)
    expect(propertyWrites(fake, 'audio-spdif')).toEqual([CODECS, ''])
    expect(controller.getState().passthroughActive).toBe(false)
  })

  it('leaves passthrough armed for a stream that is not a candidate', async () => {
    const { controller, fake } = await playWithPassthrough({
      'audio-params/format': 'floatp',
      'current-ao': 'wasapi'
    })
    fake.playbackRestart()
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS)
    expect(propertyWrites(fake, 'audio-spdif')).toEqual([CODECS])
    expect(controller.getState().passthroughActive).toBe(false)
  })

  it('clears the mpv property when the user turns passthrough off', async () => {
    const { controller, fake } = await playWithPassthrough({
      'audio-params/format': 'spdif-ac3',
      'current-ao': 'wasapi'
    })
    fake.playbackRestart()
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS)
    await controller.setAudioPassthrough(false)
    expect(propertyWrites(fake, 'audio-spdif')).toEqual([CODECS, ''])
    expect(controller.getState().passthroughActive).toBe(false)
  })

  it('a check superseded by a channel switch does not undo the newer one', async () => {
    const { controller, fake } = await playWithPassthrough({ 'audio-params/format': 'spdif-ac3' })
    // A's audio starts and its check sleeps through the settle window...
    fake.playbackRestart()
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS / 2)

    // ...when the user switches to B, whose audio starts at once.
    await controller.open(URL_B, '100')
    fake.startFile()
    fake.fileLoaded()
    fake.playbackRestart()
    await settle()

    // A wakes while the device has no output yet; acting on that would put
    // PCM back underneath B's check.
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS / 2 + 50)
    // The device then accepts B's bitstream before B's own check runs.
    fake.properties.set('current-ao', 'wasapi')
    await vi.advanceTimersByTimeAsync(MPV_PASSTHROUGH_SETTLE_MS)

    // A's stale check never wrote '' over B's armed passthrough.
    expect(propertyWrites(fake, 'audio-spdif')).toEqual([CODECS, CODECS])
    expect(controller.getState().passthroughActive).toBe(true)
  })
})

describe('MpvController per-load file options (F3-01)', () => {
  const URL_TLS = 'https://iptv.test/live/u/p/1.ts'

  it('sends the TLS options of a load with that loadfile only', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_TLS, '100', { fileOptions: { 'tls-verify': 'no' } })
    const fake = mpv.last
    expect(fake.commands('loadfile').at(-1)).toEqual(['loadfile', URL_TLS, 'replace', -1, { 'tls-verify': 'no' }])

    // The next load decides for itself; nothing carries over.
    await controller.open(URL_B, '100')
    expect(fake.commands('loadfile').at(-1)).toEqual(['loadfile', URL_B, 'replace'])
  })

  it('keeps the options when jumping to the live edge of the same playback', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_TLS, '100', { playbackId: 'T', fileOptions: { 'tls-verify': 'yes', 'tls-ca-file': '/certs/ca.pem' } })
    const fake = mpv.last
    fake.startFile()
    fake.fileLoaded()
    await settle()

    await controller.jumpToLive()
    expect(fake.commands('loadfile').at(-1)).toEqual([
      'loadfile',
      URL_TLS,
      'replace',
      -1,
      { 'tls-verify': 'yes', 'tls-ca-file': '/certs/ca.pem', 'demuxer-lavf-o': 'live_start_index=-1' }
    ])
  })
})
