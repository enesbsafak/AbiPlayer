import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MpvStateSnapshot } from '@/services/platform'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'
import type { XtreamAuthResponse } from '@/types/xtream'

const bridge = vi.hoisted(() => ({ listeners: new Set<(snapshot: MpvStateSnapshot) => void>() }))

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
    onWindowStateChange: vi.fn(() => () => undefined),
    windowGetState: vi.fn(() => Promise.resolve({ isMaximized: false, isFullScreen: false }))
  }
})

import { mpvOpen, mpvStop } from '@/services/platform'
import { resetMpvHeldPlayback, useMpvPlayer, type MpvPlayerOptions } from './useMpvPlayer'

let seq = 1000

function snapshot(overrides: Partial<MpvStateSnapshot>): MpvStateSnapshot {
  seq += 1
  return {
    sessionId: 1,
    loadId: 1,
    playbackId: useStore.getState().currentPlayback?.playbackId ?? null,
    phase: 'loading',
    seq,
    available: true,
    running: true,
    paused: false,
    buffering: false,
    timePos: 0,
    duration: 0,
    demuxerCacheDuration: 0,
    volume: 0,
    muted: true,
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

const m3uLive: Channel = {
  id: 'm',
  name: 'M',
  streamUrl: 'https://iptv.test/m/index.m3u8',
  sourceId: 'm3u',
  type: 'live'
}

const credentials = { url: 'http://panel.test:8080', username: 'u', password: 'p' }

function useXtreamAccount(formats: string[]) {
  useStore.setState({
    getXtreamCredentials: (sourceId: string) => (sourceId === 'x' ? credentials : null),
    xtreamAuth: { x: { user_info: { allowed_output_formats: formats } } as unknown as XtreamAuthResponse }
  })
}

function playXtreamLive() {
  act(() =>
    useStore.getState().startPlayback({
      target: { kind: 'live', sourceId: 'x', streamId: 7 },
      channel: { id: 'x_live_7', name: 'Yedi', streamUrl: '', sourceId: 'x', type: 'live', streamId: 7 }
    })
  )
}

const openedUrls = () => vi.mocked(mpvOpen).mock.calls.map((call) => call[0])

describe('useMpvPlayer', () => {
  const initialAuth = { getXtreamCredentials: useStore.getState().getXtreamCredentials, xtreamAuth: useStore.getState().xtreamAuth }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(mpvOpen).mockClear()
    vi.mocked(mpvStop).mockClear()
    bridge.listeners.clear()
    resetMpvHeldPlayback()
    useStore.getState().stopPlayback()
  })

  afterEach(() => {
    cleanup()
    useStore.getState().stopPlayback()
    useStore.getState().resetSettings()
    useStore.setState(initialAuth)
    vi.useRealTimers()
  })

  describe('handing mpv between hosts (F2-15)', () => {
    const keep: MpvPlayerOptions = { keepPlayingOnUnmount: () => true }

    it('keeps mpv playing when the host says so, and the next host adopts it without loading again', async () => {
      act(() => useStore.getState().playChannel(m3uLive))
      const route = renderHook(() => useMpvPlayer(true, keep))
      await act(async () => {})
      expect(openedUrls()).toEqual([m3uLive.streamUrl])
      vi.mocked(mpvStop).mockClear()

      route.unmount()
      expect(mpvStop).not.toHaveBeenCalled()

      const corner = renderHook(() => useMpvPlayer(true, keep))
      await act(async () => {})
      expect(openedUrls()).toEqual([m3uLive.streamUrl])

      // The route host mounting again (expanding) starts disabled until the
      // engine is known: it must not stop what plays.
      const back = renderHook(({ enabled }) => useMpvPlayer(enabled, keep), { initialProps: { enabled: false } })
      expect(mpvStop).not.toHaveBeenCalled()
      corner.unmount()
      back.rerender({ enabled: true })
      await act(async () => {})
      expect(openedUrls()).toEqual([m3uLive.streamUrl])
      expect(mpvStop).not.toHaveBeenCalled()
    })

    it('stops mpv on unmount without the option, as before', async () => {
      act(() => useStore.getState().playChannel(m3uLive))
      const route = renderHook(() => useMpvPlayer(true))
      await act(async () => {})
      vi.mocked(mpvStop).mockClear()
      route.unmount()
      expect(mpvStop).toHaveBeenCalledTimes(1)

      // Nothing is held any more: the next host loads the stream again.
      renderHook(() => useMpvPlayer(true))
      await act(async () => {})
      expect(openedUrls()).toEqual([m3uLive.streamUrl, m3uLive.streamUrl])
    })
  })

  describe('live format (F2-04)', () => {
    it('opens an Xtream channel in the chosen format and falls back once, telling the viewer', async () => {
      useXtreamAccount(['m3u8', 'ts'])
      act(() => useStore.getState().updateSettings({ liveStreamFormat: 'ts' }))
      playXtreamLive()
      // The store keeps the HTML5 (HLS) URL; mpv gets its own at the edge.
      expect(useStore.getState().currentPlayback?.streamUrl).toBe('http://panel.test:8080/live/u/p/7.m3u8')
      renderHook(() => useMpvPlayer(true))
      await act(async () => {})
      expect(openedUrls()).toEqual(['http://panel.test:8080/live/u/p/7.ts'])

      await push(snapshot({ loadId: 1, phase: 'error', error: 'Yayın açılamadı.' }))
      expect(openedUrls()).toEqual(['http://panel.test:8080/live/u/p/7.ts', 'http://panel.test:8080/live/u/p/7.m3u8'])
      expect(useStore.getState().playerNotice).toBe('Kanal MPEG-TS biçiminde açılamadı; HLS ile deneniyor.')
      // The failed load is not reported as a connection problem.
      expect(useStore.getState().playerError).toBeNull()

      // A late copy of the failed load changes nothing.
      await push(snapshot({ loadId: 1, phase: 'error', error: 'Yayın açılamadı.' }))
      expect(openedUrls()).toHaveLength(2)

      // The fallback fails too: from here the reconnect policy reloads, in the format that is in use.
      await push(snapshot({ loadId: 2, phase: 'error', error: 'Yayın açılamadı.' }))
      expect(useStore.getState().playerError).toMatch(/yeniden bağlanılıyor/)
      await advance(1000)
      expect(openedUrls()).toEqual([
        'http://panel.test:8080/live/u/p/7.ts',
        'http://panel.test:8080/live/u/p/7.m3u8',
        'http://panel.test:8080/live/u/p/7.m3u8'
      ])
    })

    it('never asks for a format the account does not allow, and has nothing to fall back to then', async () => {
      useXtreamAccount(['m3u8'])
      act(() => useStore.getState().updateSettings({ liveStreamFormat: 'ts' }))
      playXtreamLive()
      renderHook(() => useMpvPlayer(true))
      await act(async () => {})
      expect(openedUrls()).toEqual(['http://panel.test:8080/live/u/p/7.m3u8'])

      await push(snapshot({ loadId: 1, phase: 'error', error: 'Yayın açılamadı.' }))
      expect(openedUrls()).toHaveLength(1)
      expect(useStore.getState().playerError).toMatch(/yeniden bağlanılıyor/)
    })

    it('keeps today’s behaviour on "Otomatik": HLS, and the reconnect policy on failure', async () => {
      useXtreamAccount(['m3u8', 'ts'])
      playXtreamLive()
      renderHook(() => useMpvPlayer(true))
      await act(async () => {})
      expect(openedUrls()).toEqual(['http://panel.test:8080/live/u/p/7.m3u8'])

      await push(snapshot({ loadId: 1, phase: 'error', error: 'Yayın açılamadı.' }))
      expect(openedUrls()).toHaveLength(1)
      expect(useStore.getState().playerNotice).toBeNull()
    })
  })
})
