import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../../shared/ipc/contract'
import { MAX_DIRECT_READ_RETRIES, planDirectReadRetry, probeBeforePlayback } from './direct-playback'

describe('planDirectReadRetry', () => {
  const base = {
    streamUrl: 'https://e.com/movie/f.mkv',
    message: 'PIPELINE_ERROR_READ: FFmpegDemuxer: data source error',
    retries: 0,
    currentTime: 1200
  }

  it('reopens a direct file at its position after a read error, a few times', () => {
    expect(planDirectReadRetry(base)).toEqual({ resumeAt: 1200 })
    expect(planDirectReadRetry({ ...base, retries: MAX_DIRECT_READ_RETRIES })).toBeNull()
    expect(planDirectReadRetry({ ...base, currentTime: Number.NaN })).toEqual({ resumeAt: 0 })
  })

  it('leaves streams and other errors to their own handling', () => {
    expect(planDirectReadRetry({ ...base, streamUrl: 'https://e.com/live/a.ts' })).toBeNull()
    expect(planDirectReadRetry({ ...base, streamUrl: 'https://e.com/a.M3U8' })).toBeNull()
    expect(planDirectReadRetry({ ...base, message: 'MEDIA_ERR_DECODE' })).toBeNull()
    expect(planDirectReadRetry({ ...base, streamUrl: null })).toBeNull()
  })
})

describe('probeBeforePlayback', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not report a cancelled probe as a failure, and starts nothing for a playback that moved on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const startPlayback = vi.fn()
    let current = true
    const probe = Promise.reject(new Error(`Error invoking remote method: Error: ${MEDIA_JOB_CANCELLED_MESSAGE}`))

    const done = probeBeforePlayback({
      probe: () => probe,
      isCurrent: () => current,
      onTracks: vi.fn(),
      startPlayback
    })
    current = false
    await done

    expect(warn).not.toHaveBeenCalled()
    expect(startPlayback).not.toHaveBeenCalled()
  })

  it('starts playback after a probe failure, reporting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const startPlayback = vi.fn()
    await probeBeforePlayback({
      probe: () => Promise.reject(new Error('ffprobe 1 koduyla sonlandı')),
      isCurrent: () => true,
      onTracks: vi.fn(),
      startPlayback
    })
    expect(warn).toHaveBeenCalled()
    expect(startPlayback).toHaveBeenCalledTimes(1)
  })

  it('hands over tracks found in time, and late ones flagged as late', async () => {
    vi.useFakeTimers()
    const onTracks = vi.fn()
    await probeBeforePlayback({
      probe: () => Promise.resolve([{ index: 2, codec: 'subrip' }]),
      isCurrent: () => true,
      onTracks,
      startPlayback: vi.fn()
    })
    expect(onTracks).toHaveBeenLastCalledWith([{ index: 2, codec: 'subrip' }], false)

    let answer: (value: Array<{ index: number; codec: string }>) => void = () => undefined
    const startPlayback = vi.fn()
    const done = probeBeforePlayback({
      probe: () => new Promise((resolve) => (answer = resolve)),
      isCurrent: () => true,
      onTracks,
      startPlayback,
      timeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(startPlayback).toHaveBeenCalledTimes(1)
    answer([{ index: 4, codec: 'ass' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(onTracks).toHaveBeenLastCalledWith([{ index: 4, codec: 'ass' }], true)
  })
})
