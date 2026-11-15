/**
 * Store ids for engine tracks. The store keeps one string per selection; the
 * prefix says which engine and which list the number indexes into.
 */
export const HLS_SUBTITLE_PREFIX = 'hls:'
export const NATIVE_SUBTITLE_PREFIX = 'native:'
export const PROBED_SUBTITLE_PREFIX = 'probe:'
export const MPV_SUBTITLE_PREFIX = 'mpv-s:'
export const HLS_AUDIO_PREFIX = 'hls-a:'
export const NATIVE_AUDIO_PREFIX = 'native-a:'
export const MPV_AUDIO_PREFIX = 'mpv-a:'
/** A subtitle file the viewer loaded; its cues live in the store. */
export const EXTERNAL_SUBTITLE_ID = 'external'

export type TrackIdPrefix =
  | typeof HLS_SUBTITLE_PREFIX
  | typeof NATIVE_SUBTITLE_PREFIX
  | typeof PROBED_SUBTITLE_PREFIX
  | typeof MPV_SUBTITLE_PREFIX
  | typeof HLS_AUDIO_PREFIX
  | typeof NATIVE_AUDIO_PREFIX
  | typeof MPV_AUDIO_PREFIX

export function trackId(prefix: TrackIdPrefix, index: number): string {
  return `${prefix}${index}`
}

/** The number behind `prefix`, or null when `id` is not one of those. */
export function trackIndex(id: string | null | undefined, prefix: TrackIdPrefix): number | null {
  if (!id || !id.startsWith(prefix)) return null
  const index = Number.parseInt(id.slice(prefix.length), 10)
  return Number.isNaN(index) ? null : index
}

/** Ids persisted by old versions were bare numbers. */
export function legacyTrackIndex(id: string | null | undefined): number | null {
  if (!id) return null
  const index = Number.parseInt(id, 10)
  return Number.isNaN(index) ? null : index
}
