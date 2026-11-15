import { act, cleanup, renderHook } from '@testing-library/react'
import Hls from 'hls.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'
import type { EmbeddedSubtitleProbeTrack } from '@/services/platform'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    probeEmbeddedSubtitles: vi.fn(),
    extractEmbeddedSubtitle: vi.fn(),
    cancelMediaJob: vi.fn(() => Promise.resolve(true)),
    cancelAllMediaJobs: vi.fn(() => Promise.resolve(true))
  }
})

import {
  cancelAllMediaJobs,
  cancelMediaJob,
  extractEmbeddedSubtitle,
  probeEmbeddedSubtitles
} from '@/services/platform'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../../shared/ipc/contract'
import { HLS_MAX_CONSECUTIVE_FATAL_ERRORS, createHlsErrorRecovery } from '@/player/hls-engine'
import { SUBTITLE_PROBE_TIMEOUT_MS, releaseMediaElementSource, waitAtMost } from '@/player/direct-playback'
import { TRUNCATED_SUBTITLE_NOTICE, isTruncatedSubtitleExtraction } from '@/player/embedded-subtitles'
import { usePlayer } from './usePlayer'

const networkError = { type: Hls.ErrorTypes.NETWORK_ERROR, details: Hls.ErrorDetails.FRAG_LOAD_ERROR }
const manifestError = {
  type: Hls.ErrorTypes.NETWORK_ERROR,
  details: Hls.ErrorDetails.MANIFEST_LOAD_ERROR
}

describe('createHlsErrorRecovery', () => {
  it('gives up only after too many fatal errors in a row', () => {
    const recovery = createHlsErrorRecovery()
    for (let i = 0; i < HLS_MAX_CONSECUTIVE_FATAL_ERRORS; i++) {
      expect(recovery.nextStep(networkError).kind).toBe('restart-load')
    }
    expect(recovery.nextStep(networkError).kind).toBe('fail')
  })

  it('keeps recovering through a long session as long as media keeps arriving in between', () => {
    const recovery = createHlsErrorRecovery()
    for (let i = 0; i < HLS_MAX_CONSECUTIVE_FATAL_ERRORS * 5; i++) {
      expect(recovery.nextStep(networkError).kind).not.toBe('fail')
      recovery.noteProgress()
    }
  })

  it('restarts the backoff after progress', () => {
    const recovery = createHlsErrorRecovery()
    recovery.nextStep(networkError)
    recovery.nextStep(networkError)
    recovery.noteProgress()
    expect(recovery.nextStep(networkError)).toEqual({ kind: 'restart-load', delayMs: 1000 })
  })

  it('reloads the source after a manifest failure instead of only restarting the load', () => {
    const recovery = createHlsErrorRecovery()
    expect(recovery.nextStep(manifestError).kind).toBe('reload-source')
    expect(
      recovery.nextStep({
        type: Hls.ErrorTypes.NETWORK_ERROR,
        details: Hls.ErrorDetails.MANIFEST_PARSING_ERROR
      }).kind
    ).toBe('reload-source')
  })

  it('recovers media errors in place and fails on anything else', () => {
    const recovery = createHlsErrorRecovery()
    expect(
      recovery.nextStep({ type: Hls.ErrorTypes.MEDIA_ERROR, details: Hls.ErrorDetails.BUFFER_STALLED_ERROR })
    ).toEqual({ kind: 'recover-media' })
    expect(
      recovery.nextStep({ type: Hls.ErrorTypes.OTHER_ERROR, details: Hls.ErrorDetails.INTERNAL_EXCEPTION }).kind
    ).toBe('fail')
  })
})

describe('waitAtMost', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the value when the promise wins', async () => {
    await expect(waitAtMost(Promise.resolve(3), 1000)).resolves.toEqual({ timedOut: false, value: 3 })
  })

  it('stops waiting after the limit', async () => {
    vi.useFakeTimers()
    const pending = waitAtMost(new Promise<never>(() => undefined), 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toEqual({ timedOut: true })
  })

  it('passes a rejection through', async () => {
    await expect(waitAtMost(Promise.reject(new Error('x')), 1000)).rejects.toThrow('x')
  })
})

describe('isTruncatedSubtitleExtraction', () => {
  it('reads the optional flag and treats its absence as complete', () => {
    const complete = { format: 'vtt' as const, content: 'WEBVTT' }
    const truncated = { format: 'vtt' as const, content: 'WEBVTT', truncated: true }
    expect(isTruncatedSubtitleExtraction(complete)).toBe(false)
    expect(isTruncatedSubtitleExtraction(truncated)).toBe(true)
  })
})

describe('releaseMediaElementSource', () => {
  it('drops the source and reloads the element empty', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    const video = document.createElement('video')
    video.src = 'https://example.com/films/1.mp4'

    releaseMediaElementSource(video)

    expect(video.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('leaves an element without a source alone', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    releaseMediaElementSource(document.createElement('video'))
    expect(load).not.toHaveBeenCalled()
  })
})

function film(id: string): Channel {
  return {
    id,
    name: `Film ${id}`,
    streamUrl: `https://example.com/films/${id}.mp4`,
    sourceId: 'src',
    type: 'vod'
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('usePlayer direct playback', () => {
  let video: HTMLVideoElement

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    video = document.createElement('video')
    useStore.getState().stopPlayback()
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
    useStore.getState().stopPlayback()
    vi.useRealTimers()
  })

  function renderPlayer() {
    const videoRef = { current: video }
    return renderHook(() => usePlayer(videoRef))
  }

  it('stops the previous film as soon as another one is chosen, before the new probe answers', async () => {
    const secondProbe = deferred<EmbeddedSubtitleProbeTrack[]>()
    vi.mocked(probeEmbeddedSubtitles)
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(secondProbe.promise)

    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    await act(async () => {})
    expect(video.getAttribute('src')).toBe(film('a').streamUrl)

    act(() => useStore.getState().playChannel(film('b')))

    expect(video.hasAttribute('src')).toBe(false)
    expect(vi.mocked(probeEmbeddedSubtitles)).toHaveBeenCalledTimes(2)

    await act(async () => secondProbe.resolve([]))
    expect(video.getAttribute('src')).toBe(film('b').streamUrl)
  })

  it('starts playback when the subtitle probe takes too long, and merges its late answer', async () => {
    vi.useFakeTimers()
    const probe = deferred<EmbeddedSubtitleProbeTrack[]>()
    vi.mocked(probeEmbeddedSubtitles).mockReturnValueOnce(probe.promise)

    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBTITLE_PROBE_TIMEOUT_MS - 1)
    })
    expect(video.hasAttribute('src')).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(video.getAttribute('src')).toBe(film('a').streamUrl)

    await act(async () => probe.resolve([{ index: 3, codec: 'subrip', language: 'tur' }]))
    expect(useStore.getState().subtitleTracks.map((track) => track.id)).toContain('probe:3')
  })

  it('loads the same film again when playback is reloaded', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockResolvedValue([])
    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    await act(async () => {})
    expect(vi.mocked(probeEmbeddedSubtitles)).toHaveBeenCalledTimes(1)

    act(() => useStore.getState().reloadPlayback())
    expect(video.hasAttribute('src')).toBe(false)
    await act(async () => {})

    expect(vi.mocked(probeEmbeddedSubtitles)).toHaveBeenCalledTimes(2)
    expect(video.getAttribute('src')).toBe(film('a').streamUrl)
  })

  it('tells the viewer when an extracted subtitle is incomplete', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockResolvedValue([{ index: 2, codec: 'subrip' }])
    const extraction = {
      format: 'vtt' as const,
      content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerhaba\n',
      truncated: true
    }
    vi.mocked(extractEmbeddedSubtitle).mockResolvedValue(extraction)

    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    await act(async () => {})
    await act(async () => useStore.getState().selectSubtitleTrack('probe:2'))

    expect(useStore.getState().subtitleCues).toHaveLength(1)
    expect(useStore.getState().playerNotice).toBe(TRUNCATED_SUBTITLE_NOTICE)
  })

  it('cancels a probe still running when the playback changes, without reporting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const firstProbe = deferred<EmbeddedSubtitleProbeTrack[]>()
    vi.mocked(probeEmbeddedSubtitles)
      .mockReturnValueOnce(firstProbe.promise)
      .mockResolvedValueOnce([])
    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    const jobId = vi.mocked(probeEmbeddedSubtitles).mock.calls[0]?.[1]?.jobId
    expect(jobId).toEqual(expect.any(String))

    act(() => useStore.getState().playChannel(film('b')))
    expect(vi.mocked(cancelMediaJob)).toHaveBeenCalledWith(jobId)

    // Main answers the cancelled call with its cancellation error.
    await act(async () => firstProbe.reject(new Error(MEDIA_JOB_CANCELLED_MESSAGE)))
    expect(warn).not.toHaveBeenCalled()
    expect(video.getAttribute('src')).toBe(film('b').streamUrl)
  })

  it('cancels every media job when the player goes away', () => {
    vi.mocked(probeEmbeddedSubtitles).mockReturnValue(new Promise(() => undefined))
    act(() => useStore.getState().playChannel(film('a')))
    const { unmount } = renderPlayer()
    unmount()
    expect(vi.mocked(cancelAllMediaJobs)).toHaveBeenCalled()
  })

  it('keeps the subtitle chosen for a film when that film is reloaded', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockResolvedValue([
      { index: 2, codec: 'subrip', language: 'eng' },
      { index: 3, codec: 'subrip', language: 'tur' }
    ])
    useStore.getState().updateSettings({ defaultSubtitleEnabled: true, preferredSubtitleLanguage: 'tr' })
    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    await act(async () => {})
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(useStore.getState().currentSubtitleTrack).toBe('probe:3')

    // The viewer goes for the other one, then reloads.
    act(() => useStore.getState().selectSubtitleTrack('probe:2'))
    act(() => useStore.getState().reloadPlayback())
    await act(async () => {})
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(useStore.getState().currentSubtitleTrack).toBe('probe:2')
    useStore.getState().resetSettings()
  })

  it('stays quiet about a complete extraction', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockResolvedValue([{ index: 2, codec: 'subrip' }])
    vi.mocked(extractEmbeddedSubtitle).mockResolvedValue({
      format: 'vtt',
      content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerhaba\n'
    })

    act(() => useStore.getState().playChannel(film('a')))
    renderPlayer()
    await act(async () => {})
    await act(async () => useStore.getState().selectSubtitleTrack('probe:2'))

    expect(useStore.getState().subtitleCues).toHaveLength(1)
    expect(useStore.getState().playerNotice).toBeNull()
  })
})
