import { powerSaveBlocker } from 'electron'

/**
 * Keeps the display awake while something is playing.
 *
 * Windows dims and then locks the screen on its idle timer, which has no idea
 * a video is running — mpv renders into our window without going through any
 * API that resets the idle timer. Two hours into a film the screen goes black.
 *
 * `prevent-display-sleep` is the weaker of the two blockers on purpose: it
 * stops the screen from blanking but still allows the machine to suspend if
 * the user closes the lid or suspends deliberately.
 */
let blockerId: number | null = null

export function setPreventDisplaySleep(active: boolean): void {
  if (active) {
    // Already holding one — starting a second would leak the first id and
    // leave a blocker nothing can ever stop.
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return
    blockerId = powerSaveBlocker.start('prevent-display-sleep')
    return
  }

  if (blockerId === null) return
  if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
  blockerId = null
}
