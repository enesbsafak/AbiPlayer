import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchHtml5LiveStream } from './html5-live-watch'
import { STALL_THRESHOLD_MS, reconnectingMessage } from './reconnect-policy'

function fakeVideo() {
  const video = document.createElement('video')
  let time = 0
  let paused = false
  Object.defineProperty(video, 'currentTime', { get: () => time, configurable: true })
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true })
  return {
    video,
    tick(next: number) {
      time = next
      video.dispatchEvent(new Event('timeupdate'))
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

  it('reconnects a live stream whose position stopped moving, and clears the message once it moves', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const showMessage = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage })

    element.tick(1)
    element.tick(1)
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1)
    expect(showMessage).toHaveBeenLastCalledWith(reconnectingMessage(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(reconnect).toHaveBeenCalledTimes(1)

    element.tick(2)
    expect(showMessage).toHaveBeenLastCalledWith(null)
    stop()
  })

  it('does not take a long pause for a stall', async () => {
    const element = fakeVideo()
    const reconnect = vi.fn()
    const stop = watchHtml5LiveStream(element.video, { reconnect, showMessage: vi.fn() })

    element.tick(1)
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
    element.tick(1)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reconnect).not.toHaveBeenCalled()
  })
})
