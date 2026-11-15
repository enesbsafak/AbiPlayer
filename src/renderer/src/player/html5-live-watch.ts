import { createReconnectDriver, type ReconnectDriverOptions } from './reconnect-policy'

export interface Html5LiveWatchOptions {
  /** Reload the stream (hls.js restarts loading, a plain source is set again). */
  reconnect: (attempt: number) => void
  showMessage: (message: string | null) => void
  now?: ReconnectDriverOptions['now']
  setTimer?: ReconnectDriverOptions['setTimer']
  clearTimer?: ReconnectDriverOptions['clearTimer']
}

/**
 * Feeds a live `<video>` into the shared reconnect policy. Progress is the
 * element's position moving forward; the element reports nothing while it
 * stalls, so the policy's own deadline does the noticing.
 */
export function watchHtml5LiveStream(video: HTMLVideoElement, options: Html5LiveWatchOptions): () => void {
  const driver = createReconnectDriver(options)
  let lastTimePos = -1

  const observe = (progressing: boolean): void => {
    driver.observe({ isLive: true, progressing, expectingProgress: !video.paused, error: null })
  }

  const onTimeUpdate = (): void => {
    const time = video.currentTime
    const progressing = time !== lastTimePos && time > 0
    if (progressing) lastTimePos = time
    observe(progressing)
  }
  const onPlayStateChange = (): void => observe(false)

  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('pause', onPlayStateChange)
  video.addEventListener('play', onPlayStateChange)

  return () => {
    driver.dispose()
    video.removeEventListener('timeupdate', onTimeUpdate)
    video.removeEventListener('pause', onPlayStateChange)
    video.removeEventListener('play', onPlayStateChange)
  }
}
