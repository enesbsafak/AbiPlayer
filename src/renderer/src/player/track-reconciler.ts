import { itemAt } from '../../../shared/checked'
import type { AudioTrack, SubtitleTrack, VideoQualityOption } from '@/types/player'
import { AUTO_VIDEO_QUALITY_ID } from '@/services/quality'
import { pickPreferredAudioTrackId, pickPreferredSubtitleTrackId } from '@/services/track-preferences'
import { matchRememberedTrack, type RememberedTracks } from '@/services/track-memory'
import { EXTERNAL_SUBTITLE_ID } from './track-ids'

/**
 * Where the language preferences stand for the item being played. Applied
 * once per item (media key), not again on a reload of it.
 */
export interface TrackPreferenceState {
  audioPreferenceApplied: boolean
  subtitlePreferenceApplied: boolean
  /**
   * Subtitles were turned off for this item without the viewer doing it now:
   * by the "subtitles on by default" setting, or by the "off" remembered for
   * its series.
   */
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
  /** What the viewer last chose for this series or item; goes before the settings. */
  rememberedTracks?: RememberedTracks | null
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
 * A valid selection is kept. Otherwise the track remembered for the series or
 * item, else the preferred language, is applied once
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
    const remembered = context.rememberedTracks?.audio
    const preferred =
      (remembered ? matchRememberedTrack(tracks, remembered) : null) ??
      pickPreferredAudioTrackId(tracks, context.settings.preferredAudioLanguage)
    const next = { ...state, audioPreferenceApplied: true }
    return preferred !== current ? { track: preferred, state: next } : { state: next }
  }

  const fallback = has(tracks, engineSelected)
    ? engineSelected
    : (tracks.find((track) => track.default) ?? itemAt(tracks, 0)).id
  return fallback !== current ? { track: fallback, state } : { state }
}

/**
 * The store's subtitle selection for one engine track list (both engines).
 *
 * A loaded subtitle file and a valid selection are kept. An empty list clears
 * the selection but keeps the preference for a list that arrives later. The
 * preference is applied once per item, never over a choice the viewer made:
 * what the viewer last chose for this series or item (a track of the same
 * language, or "off") goes first, then the settings; with "subtitles on by
 * default" off they turn subtitles off. After that, a subtitle the engine
 * picked is only mirrored while nobody decided anything, an invalid selection
 * is cleared, and a subtitle the engine shows although they are off (it keeps
 * its own selection from the item before) is turned off again.
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

    const remembered = context.rememberedTracks?.subtitle
    const rememberedTrack = remembered && remembered !== 'off' ? matchRememberedTrack(tracks, remembered) : null
    if (rememberedTrack !== null) {
      return rememberedTrack !== current
        ? { track: rememberedTrack, disableEngineSubtitles: false, state: next }
        : { disableEngineSubtitles: false, state: next }
    }

    // A remembered language this item does not have falls back to the settings.
    if (remembered === 'off' || !context.settings.defaultSubtitleEnabled) {
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
  if (current !== null) return { ...keep, track: null }
  const off = context.isSubtitleTrackUserChoice || state.subtitlesOffByDefault
  return off && engineSelected !== null ? { ...keep, disableEngineSubtitles: true } : keep
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
      other !== undefined &&
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
      other !== undefined &&
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
    return other !== undefined && option.id === other.id && option.label === other.label
  })
}
