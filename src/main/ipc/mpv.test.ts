// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { IpcInvokeChannel } from '../../shared/ipc/contract'
import type { MpvStateSnapshot } from '../../shared/types/electron-ipc'
import { SUBTITLE_NOT_PICKED_MESSAGE, maskSnapshotError, registerMpvHandlers, type MpvControllerApi } from './mpv'
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
    seekTo: vi.fn().mockResolvedValue(undefined)
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
})

describe('maskSnapshotError', () => {
  it('masks credentials in the mpv error text only', () => {
    const state = { error: 'http://p.example/live/ali/s3cret/1.ts: 403', path: 'http://p.example/live/ali/s3cret/1.ts' } as MpvStateSnapshot
    expect(maskSnapshotError(state)).toEqual({ error: 'http://p.example/live/***/***/1.ts: 403', path: state.path })
    const clean = { error: null } as MpvStateSnapshot
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
