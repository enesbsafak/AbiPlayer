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
 * element's position moving forward. A frozen stream mostly reports nothing
 * at all (no more `timeupdate`), sometimes `waiting` or `stalled` first; the
 * policy's own deadline takes the silence for no progress.
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
  const onNoProgress = (): void => observe(false)
  const noProgressEvents = ['pause', 'play', 'waiting', 'stalled'] as const

  video.addEventListener('timeupdate', onTimeUpdate)
  for (const type of noProgressEvents) video.addEventListener(type, onNoProgress)

  return () => {
    driver.dispose()
    video.removeEventListener('timeupdate', onTimeUpdate)
    for (const type of noProgressEvents) video.removeEventListener(type, onNoProgress)
  }
}
