import type { AudioTrack, SubtitleTrack, VideoQualityOption } from '@/types/player'
import { AUTO_VIDEO_QUALITY_ID } from '@/services/quality'
import { pickPreferredAudioTrackId, pickPreferredSubtitleTrackId } from '@/services/track-preferences'
import { EXTERNAL_SUBTITLE_ID } from './track-ids'

/**
 * Where the language preferences stand for the item being played. Applied
 * once per item (media key), not again on a reload of it.
 */
export interface TrackPreferenceState {
  audioPreferenceApplied: boolean
  subtitlePreferenceApplied: boolean
  /** The "subtitles on by default" setting is off and was applied to this item. */
  subtitlesOffByDefault: boolean
}

export const FRESH_TRACK_PREFERENCES: TrackPreferenceState = Object.freeze({
  audioPreferenceApplied: false,
  subtitlePreferenceApplied: false,
  subtitlesOffByDefault: false
})

export interface TrackSelectionContext {
  currentAudioTrack: string | null
  currentSubtitleTrack: string | null
  /** The viewer picked the subtitle (or "off") for this stream. */
  isSubtitleTrackUserChoice: boolean
  settings: {
    preferredAudioLanguage: string
    preferredSubtitleLanguage: string
    defaultSubtitleEnabled: boolean
  }
}

export interface AudioSelectionResult {
  /** `undefined` leaves the store's selection alone. */
  track?: string | null
  state: TrackPreferenceState
}

export interface SubtitleSelectionResult {
  track?: string | null
  /** The engine shows a subtitle on its own although the setting says off. */
  disableEngineSubtitles: boolean
  state: TrackPreferenceState
}

function has(tracks: Array<{ id: string | number }>, id: string | null): id is string {
  return id !== null && tracks.some((track) => String(track.id) === id)
}

/**
 * The store's audio selection for one engine track list (both engines).
 *
 * A valid selection is kept. Otherwise the preferred language is applied once
 * per item; after that an invalid or missing selection falls back to what the
 * engine itself plays (`engineSelected`), then the default track, then the
 * first. Call it only once the engine knows the stream's tracks: an empty list
 * here means "this stream has no audio track".
 */
export function reconcileAudioSelection(
  tracks: AudioTrack[],
  engineSelected: string | null,
  context: TrackSelectionContext,
  state: TrackPreferenceState
): AudioSelectionResult {
  const current = context.currentAudioTrack
  if (tracks.length === 0) return current !== null ? { track: null, state } : { state }

  if (has(tracks, current)) {
    return state.audioPreferenceApplied ? { state } : { state: { ...state, audioPreferenceApplied: true } }
  }

  if (!state.audioPreferenceApplied) {
    const preferred = pickPreferredAudioTrackId(tracks, context.settings.preferredAudioLanguage)
    const next = { ...state, audioPreferenceApplied: true }
    return preferred !== current ? { track: preferred, state: next } : { state: next }
  }

  const fallback = has(tracks, engineSelected)
    ? engineSelected
    : (tracks.find((track) => track.default) ?? tracks[0]).id
  return fallback !== current ? { track: fallback, state } : { state }
}

/**
 * The store's subtitle selection for one engine track list (both engines).
 *
 * A loaded subtitle file and a valid selection are kept. An empty list clears
 * the selection but keeps the preference for a list that arrives later. The
 * preference is applied once per item, never over a choice the viewer made;
 * with "subtitles on by default" off it turns subtitles off, including one the
 * engine picked on its own. After that, a subtitle the engine picked is only
 * mirrored while nobody decided anything, and an invalid selection is cleared.
 */
export function reconcileSubtitleSelection(
  tracks: SubtitleTrack[],
  engineSelected: string | null,
  context: TrackSelectionContext,
  state: TrackPreferenceState
): SubtitleSelectionResult {
  const current = context.currentSubtitleTrack
  const keep = { disableEngineSubtitles: false, state }
  if (current === EXTERNAL_SUBTITLE_ID) return keep
  if (tracks.length === 0) return current !== null ? { ...keep, track: null } : keep

  if (has(tracks, current)) {
    return state.subtitlePreferenceApplied
      ? keep
      : { disableEngineSubtitles: false, state: { ...state, subtitlePreferenceApplied: true } }
  }

  if (!state.subtitlePreferenceApplied) {
    const next = { ...state, subtitlePreferenceApplied: true }
    // The viewer already decided for this stream; nothing left to prefer.
    if (context.isSubtitleTrackUserChoice) return { disableEngineSubtitles: false, state: next }

    if (!context.settings.defaultSubtitleEnabled) {
      return {
        ...(current !== null ? { track: null } : {}),
        disableEngineSubtitles: engineSelected !== null,
        state: { ...next, subtitlesOffByDefault: true }
      }
    }

    const preferred = pickPreferredSubtitleTrackId(tracks, context.settings.preferredSubtitleLanguage)
    return preferred !== current
      ? { track: preferred, disableEngineSubtitles: false, state: next }
      : { disableEngineSubtitles: false, state: next }
  }

  if (
    current === null &&
    has(tracks, engineSelected) &&
    !context.isSubtitleTrackUserChoice &&
    !state.subtitlesOffByDefault
  ) {
    return { ...keep, track: engineSelected }
  }
  return current !== null ? { ...keep, track: null } : keep
}

/**
 * The quality selection for an option list: none without options, a valid
 * choice kept, otherwise automatic.
 */
export function normalizeVideoQualitySelection(
  options: VideoQualityOption[],
  selected: string | null
): string | null {
  if (options.length === 0) return null
  if (selected !== null && options.some((option) => option.id === selected)) return selected
  return AUTO_VIDEO_QUALITY_ID
}

export function sameAudioTracks(a: AudioTrack[], b: AudioTrack[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((track, index) => {
    const other = b[index]
    return (
      track.id === other.id &&
      track.name === other.name &&
      track.lang === other.lang &&
      track.default === other.default
    )
  })
}

export function sameSubtitleTracks(a: SubtitleTrack[], b: SubtitleTrack[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((track, index) => {
    const other = b[index]
    return (
      track.id === other.id &&
      track.name === other.name &&
      track.lang === other.lang &&
      track.type === other.type
    )
  })
}

export function sameQualityOptions(a: VideoQualityOption[], b: VideoQualityOption[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((option, index) => {
    const other = b[index]
    return option.id === other.id && option.label === other.label
  })
}
