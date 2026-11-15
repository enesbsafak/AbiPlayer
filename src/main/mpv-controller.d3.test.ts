// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MpvController, type MpvControllerDeps } from './mpv-controller'
import { FakeMpv, type FakeMpvProcess } from './mpv/testing/fake-mpv'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const URL_A = 'http://iptv.test/a.ts'

function setup(overrides: Partial<MpvControllerDeps> = {}) {
  const mpv = new FakeMpv()
  let pipe = 0
  const marks: Array<{ name: string; detail?: Record<string, number> }> = []
  const controller = new MpvController({
    resolveBinary: () => '/fake/mpv',
    spawn: mpv.spawn,
    connect: mpv.connect,
    createSocketPath: () => `fake-pipe-${++pipe}`,
    removeSocketFile: undefined,
    mark: (name, detail) => marks.push({ name, detail }),
    ...overrides
  })
  return { mpv, controller, marks }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

function lastWrite(fake: FakeMpvProcess, name: string): unknown {
  const writes = fake.setProperties().filter(([key]) => key === name)
  return writes.length > 0 ? writes[writes.length - 1][1] : undefined
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MpvController timing marks (F2-01)', () => {
  it('marks the open, the process start and every step of the load it belongs to, in order', async () => {
    const { mpv, controller, marks } = setup()
    await controller.open(URL_A, '100', { playbackId: 'p1' })
    const fake = mpv.last
    fake.startFile()
    fake.fileLoaded()
    fake.playbackRestart()
    await settle()

    expect(marks.map((mark) => mark.name)).toEqual([
      'mpv:open',
      'mpv:spawn',
      'mpv:pipe-connected',
      'mpv:session-ready',
      'mpv:loadfile-sent',
      'mpv:loadfile-replied',
      'mpv:start-file',
      'mpv:file-loaded',
      'mpv:playback-restart'
    ])
    expect(marks.find((mark) => mark.name === 'mpv:file-loaded')?.detail).toEqual({ session: 1, load: 1 })
  })

  it('marks nothing for events of a load that is not the current one', async () => {
    const { mpv, controller, marks } = setup()
    await controller.open(URL_A, '100', { playbackId: 'p1' })
    marks.length = 0
    // A start-file for another playlist entry (an earlier file) is not ours.
    mpv.last.startFile(999)
    await settle()
    expect(marks).toEqual([])
  })
})

describe('MpvController video rectangle (corner player, F2-15)', () => {
  it('confines the picture with all four margins and gives the window back on null', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_A, '100', { playbackId: 'p1' })
    const fake = mpv.last

    await controller.setVideoRect({ left: 0.7, right: 0.02, top: 0.7, bottom: 0.03 })
    expect(lastWrite(fake, 'video-margin-ratio-left')).toBe(0.7)
    expect(lastWrite(fake, 'video-margin-ratio-right')).toBe(0.02)
    expect(lastWrite(fake, 'video-margin-ratio-top')).toBe(0.7)
    expect(lastWrite(fake, 'video-margin-ratio-bottom')).toBe(0.03)

    await controller.setVideoRect(null)
    for (const side of ['left', 'right', 'top', 'bottom']) {
      expect(lastWrite(fake, `video-margin-ratio-${side}`)).toBe(0)
    }
  })

  it('keeps the sidebar margin underneath: the right margin comes back when the rectangle goes', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_A, '100', { playbackId: 'p1' })
    await controller.setVideoMarginRatio(0.25)
    await controller.setVideoRect({ left: 0.5, right: 0.1, top: 0.5, bottom: 0.1 })
    expect(lastWrite(mpv.last, 'video-margin-ratio-right')).toBe(0.1)
    await controller.setVideoRect(null)
    expect(lastWrite(mpv.last, 'video-margin-ratio-right')).toBe(0.25)
  })

  it('sends nothing for margins a fresh process already has', async () => {
    const { mpv, controller } = setup()
    await controller.open(URL_A, '100', { playbackId: 'p1' })
    const writes = mpv.last.setProperties().map(([key]) => key)
    expect(writes.filter((key) => key.startsWith('video-margin-ratio-'))).toEqual([])
  })
})
