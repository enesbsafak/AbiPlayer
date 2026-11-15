import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchHtml5LiveStream } from './html5-live-watch'
import { MAX_RECONNECT_ATTEMPTS, STALL_THRESHOLD_MS, reconnectingMessage } from './reconnect-policy'

/** Chromium sends `timeupdate` about every 250 ms while the position moves. */
const TIMEUPDATE_MS = 250

/**
 * A live `<video>` as a browser drives it: while the stream flows the position
 * advances and `timeupdate` fires every 250 ms; when it freezes the position
 * holds and the events stop, sometimes after a `waiting` or `stalled`.
 */
function fakeVideo() {
  const video = document.createElement('video')
  let time = 0
  let paused = false
  Object.defineProperty(video, 'currentTime', { get: () => time, configurable: true })
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true })
  return {
    video,
    /** Plays for `ms`, the position moving with the clock. */
    async flow(ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += TIMEUPDATE_MS) {
        time += TIMEUPDATE_MS / 1000
        video.dispatchEvent(new Event('timeupdate'))
        await vi.advanceTimersByTimeAsync(TIMEUPDATE_MS)
      }
    },
    emit(type: 'waiting' | 'stalled') {
      video.dispatchEvent(new Event(type))
    },
    pause() {
      paused = true
      video.dispatchEvent(new Event('pause'))
    },
    play() {
      paused = false
      video.dispatchEvent(new Event('play'))
    }
  }
}

describe('watchHtml5LiveStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconnects a stream that froze without another event, and clears the message once it moves again', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const showMessage = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage })

    await element.flow(5_000)
    // Frozen: no event of any kind from here on.
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1)
    expect(showMessage).toHaveBeenLastCalledWith(reconnectingMessage(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(reconnect).toHaveBeenCalledTimes(1)

    await element.flow(TIMEUPDATE_MS)
    expect(showMessage).toHaveBeenLastCalledWith(null)
    stop()
  })

  it.each(['waiting', 'stalled'] as const)('reconnects a stream that reported %s and then went silent', async (type) => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage: vi.fn() })

    await element.flow(2_000)
    element.emit(type)
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1 + 1000)
    expect(reconnect).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps trying while the stream stays frozen, up to the limit', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage: vi.fn() })

    await element.flow(1_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(reconnect).toHaveBeenCalledTimes(MAX_RECONNECT_ATTEMPTS)
    stop()
  })

  it('leaves a stream that keeps playing alone', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage: vi.fn() })
    await element.flow(90_000)
    expect(reconnect).not.toHaveBeenCalled()
    stop()
  })

  it('does not take a long pause for a stall', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage: vi.fn() })

    await element.flow(1_000)
    element.pause()
    await vi.advanceTimersByTimeAsync(60_000)
    element.play()
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS - 1)
    expect(reconnect).not.toHaveBeenCalled()
    stop()
  })

  it('stops watching when stopped', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage: vi.fn() })
    await element.flow(1_000)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reconnect).not.toHaveBeenCalled()
  })
})
