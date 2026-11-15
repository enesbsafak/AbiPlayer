import type { Channel } from './playlist'
import type { PlayableTarget, PlaybackId, PlaybackTarget } from '../../../shared/playback'

/** One playback intent, as the player store records it. */
export interface CurrentPlayback {
  playbackId: PlaybackId
  target: PlayableTarget
  /** `mediaKey(target)`: what history and resume are keyed by. */
  mediaKey: string
  /** Resolved by `resolveStreamUrl` when the playback started or was reloaded. */
  streamUrl: string
}

/**
 * A resume seek owed to one playback. `awaiting-load` until the engine reports
 * that playback loaded, then `seek-issued` until the seek is confirmed.
 */
export interface PendingResume {
  playbackId: PlaybackId
  mediaKey: string
  phase: 'awaiting-load' | 'seek-issued'
  /** Where the seek went; null while still awaiting the load. */
  position: number | null
}

/** What to play and what the UI shows for it while it plays. */
export interface PlaybackRequest {
  target: PlaybackTarget
  /**
   * Display data (name, artwork, type). Its `streamUrl` is the M3U entry's URL,
   * or for Xtream items a stored URL used only when none can be derived.
   */
  channel: Channel
}

/** One series episode to play, as the series page knows it. */
export interface EpisodePlaybackRequest {
  sourceId: string
  seriesId: number
  season: number
  episodeNum: number
  /** Xtream episode id (the stream id of its URL). */
  episodeId: number
  containerExtension: string
  title: string
  coverUrl?: string
  /** URL the series page already built; used only if none can be derived. */
  fallbackStreamUrl?: string
}

export interface AudioTrack {
  id: string
  name: string
  lang?: string
  default?: boolean
}

export interface SubtitleTrack {
  id: number | string
  name: string
  lang?: string
  type: 'embedded' | 'external'
  url?: string
  default?: boolean
}

export interface SubtitleCue {
  startTime: number
  endTime: number
  text: string
  style?: SubtitleStyle
}

export interface VideoQualityOption {
  id: string
  label: string
  shortLabel: string
  bitrate?: number
  height?: number
  auto?: boolean
}

export interface SubtitleStyle {
  color?: string
  fontSize?: string
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  alignment?: number
  marginV?: number
  outline?: number
  shadow?: number
}
