import { describe, expect, it, vi } from 'vitest'
import { wireMediaElementEvents } from './media-events'

describe('wireMediaElementEvents', () => {
  it('removes every handler, and the once-listeners they added, in one call', () => {
    const video = document.createElement('video')
    const onPlay = vi.fn()
    const onMetadata = vi.fn()
    const unwire = wireMediaElementEvents(video, (signal) => ({
      play: onPlay,
      error: () => video.addEventListener('loadedmetadata', onMetadata, { once: true, signal })
    }))

    video.dispatchEvent(new Event('play'))
    video.dispatchEvent(new Event('error'))
    unwire()
    video.dispatchEvent(new Event('play'))
    video.dispatchEvent(new Event('loadedmetadata'))

    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onMetadata).not.toHaveBeenCalled()
  })
})
