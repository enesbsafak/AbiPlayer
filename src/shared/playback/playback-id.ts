/**
 * Opaque id for one playback intent: issued by the renderer every time the
 * viewer starts something, deliberately reloads it, or comes back to it after
 * it was suspended. Two playbacks of the same media key always have different
 * ids, so a late engine report, probe result or resume for an earlier attempt
 * can be told apart from the current one.
 *
 * Only equality is meaningful; nothing may parse it.
 */
export type PlaybackId = string

let counter = 0
const sessionPrefix = Math.floor(Math.random() * 0x100000000).toString(36)

export function createPlaybackId(): PlaybackId {
  counter += 1
  return `pb-${sessionPrefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}
