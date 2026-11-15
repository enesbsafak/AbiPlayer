import type { AudioTrack, SubtitleTrack, VideoQualityOption } from '@/types/player'
import type { PlayerPatch } from '@/store/player-slice'
import type { MpvStateSnapshot, MpvTrackInfo } from '@/services/platform'
import {
  buildMpvVideoQualityOptions,
  getActiveMpvVideoQualityId
} from '@/services/quality'
import { CONNECTION_LOST_MESSAGE, type ReconnectObservation } from './reconnect-policy'
import { MPV_AUDIO_PREFIX, MPV_SUBTITLE_PREFIX, trackId } from './track-ids'
import {
  normalizeVideoQualitySelection,
  reconcileAudioSelection,
  reconcileSubtitleSelection,
  sameAudioTracks,
  sameQualityOptions,
  sameSubtitleTracks,
  type TrackPreferenceState,
  type TrackSelectionContext
} from './track-reconciler'

export const MPV_STARTUP_OVERLAY_TIMEOUT_MS = 15_000

/**
 * Whether a delivered snapshot is newer than the last one applied. Main
 * numbers its snapshots; the subscription's first answer and the pushes after
 * it can arrive in either order, and a re-subscription repeats the current one.
 */
export function isNewerSnapshot(lastSeq: number | null, snapshot: Pick<MpvStateSnapshot, 'seq'>): boolean {
  return lastSeq === null || snapshot.seq > lastSeq
}

/** Only a snapshot stamped with the current playback id describes it. */
export function isSnapshotForPlayback(
  snapshot: Pick<MpvStateSnapshot, 'playbackId'>,
  playbackId: string | null
): boolean {
  return playbackId !== null && snapshot.playbackId === playbackId
}

/**
 * What one snapshot tells the shared reconnect policy.
 *
 * A live stream has no end. mpv keeps the last frame open (`--keep-open`) and
 * reports `ended` when the server closes it cleanly, with no error and nothing
 * left to expect; for a live target that is a lost connection like any other
 * and is reported as a failure of that load.
 */
export function mpvReconnectObservation(snapshot: MpvStateSnapshot, isLive: boolean): ReconnectObservation {
  const endedLive = isLive && snapshot.phase === 'ended'
  return {
    isLive,
    // Time-pos is unreliable as a liveness signal (many live feeds hold it or
    // reset it while healthy); mpv's demuxer underrun flag is not.
    progressing: snapshot.phase === 'playing' && !snapshot.buffering && !snapshot.paused,
    expectingProgress: !snapshot.paused && (snapshot.phase === 'loading' || snapshot.phase === 'playing'),
    error: snapshot.error ?? (endedLive ? CONNECTION_LOST_MESSAGE : null),
    errorKey: snapshot.loadId
  }
}

/** The stream of that load is open far enough to seek (mpv's `file-loaded`). */
export function isSnapshotLoaded(snapshot: Pick<MpvStateSnapshot, 'phase'>): boolean {
  return snapshot.phase === 'playing' || snapshot.phase === 'ended'
}

/**
 * The startup overlay covers a cold start: it stays until the current
 * playback shows signs of life, fails, or the time limit passes. `snapshot` is
 * the newest one for the current playback, or null when none arrived yet.
 */
export function shouldKeepStartupOverlay(
  snapshot: MpvStateSnapshot | null,
  startedAt: number | null,
  now = Date.now()
): boolean {
  if (startedAt === null) return false
  if (now - startedAt >= MPV_STARTUP_OVERLAY_TIMEOUT_MS) return false
  if (!snapshot) return true
  if (snapshot.error || snapshot.phase === 'error') return false
  if (snapshot.timePos > 0 || snapshot.tracks.length > 0) return false
  // Running and unpaused: mpv is processing the stream (buffering or playing).
  if (snapshot.running && !snapshot.paused) return false
  return true
}

export function mapMpvAudioTracks(tracks: MpvTrackInfo[]): AudioTrack[] {
  const audioTracks: AudioTrack[] = []
  for (const track of tracks) {
    if (track.type !== 'audio') continue
    audioTracks.push({
      id: trackId(MPV_AUDIO_PREFIX, track.id),
      name: track.title || track.lang || `Ses ${audioTracks.length + 1}`,
      lang: track.lang,
      default: track.selected
    })
  }
  return audioTracks
}

export function mapMpvSubtitleTracks(tracks: MpvTrackInfo[]): SubtitleTrack[] {
  const subtitleTracks: SubtitleTrack[] = []
  for (const track of tracks) {
    if (track.type !== 'sub') continue
    subtitleTracks.push({
      id: trackId(MPV_SUBTITLE_PREFIX, track.id),
      name: track.title || track.lang || `Altyazı ${subtitleTracks.length + 1}`,
      lang: track.lang,
      type: track.external ? 'external' : 'embedded'
    })
  }
  return subtitleTracks
}

function selectedVideoTrackId(snapshot: Pick<MpvStateSnapshot, 'tracks' | 'vid'>): number | null {
  const selected = snapshot.tracks.find((track) => track.type === 'video' && track.selected)
  return selected?.id ?? snapshot.vid
}

/** The slice of the player store an mpv snapshot is reconciled against. */
export interface MpvStoreView extends TrackSelectionContext {
  isPlaying: boolean
  isPaused: boolean
  isBuffering: boolean
  currentTime: number
  duration: number
  demuxerCacheDuration: number
  isFullscreen: boolean
  passthroughActive: boolean
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  videoQualityOptions: VideoQualityOption[]
  currentVideoQuality: string | null
  activeVideoQuality: string | null
}

export interface MpvReconcileResult {
  /** Only the keys whose value actually changed. */
  patch: PlayerPatch
  preferences: TrackPreferenceState
  /** mpv shows a subtitle on its own although the setting says off. */
  disableMpvSubtitles: boolean
}

/**
 * Turns one snapshot of the current playback into a store patch carrying only
 * what moved: snapshots arrive several times a second and every written key
 * re-renders its consumers. Selections follow the shared track reconciler,
 * applied only once the load's track list is there.
 */
export function reconcileMpvSnapshot(
  snapshot: MpvStateSnapshot,
  store: MpvStoreView,
  preferences: TrackPreferenceState,
  windowFullscreen: boolean
): MpvReconcileResult {
  const patch: PlayerPatch = {}

  const isPlaying = snapshot.running && !snapshot.paused
  if (store.isPlaying !== isPlaying) patch.isPlaying = isPlaying
  if (store.isPaused !== snapshot.paused) patch.isPaused = snapshot.paused
  if (store.isBuffering !== snapshot.buffering) patch.isBuffering = snapshot.buffering

  const timePos = snapshot.timePos || 0
  if (store.currentTime !== timePos) patch.currentTime = timePos
  const duration = snapshot.duration || 0
  if (store.duration !== duration) patch.duration = duration
  const cacheDuration = snapshot.demuxerCacheDuration || 0
  if (store.demuxerCacheDuration !== cacheDuration) patch.demuxerCacheDuration = cacheDuration

  const fullscreen = windowFullscreen || snapshot.fullscreen
  if (store.isFullscreen !== fullscreen) patch.isFullscreen = fullscreen
  if (store.passthroughActive !== snapshot.passthroughActive) patch.passthroughActive = snapshot.passthroughActive

  const audioTracks = mapMpvAudioTracks(snapshot.tracks)
  const subtitleTracks = mapMpvSubtitleTracks(snapshot.tracks)
  if (!sameAudioTracks(store.audioTracks, audioTracks)) patch.audioTracks = audioTracks
  if (!sameSubtitleTracks(store.subtitleTracks, subtitleTracks)) patch.subtitleTracks = subtitleTracks

  let nextPreferences = preferences
  let disableMpvSubtitles = false
  // An empty list means mpv is still opening this load, not that it has no tracks.
  if (snapshot.tracks.length > 0) {
    const audio = reconcileAudioSelection(
      audioTracks,
      snapshot.aid ? trackId(MPV_AUDIO_PREFIX, snapshot.aid) : null,
      store,
      nextPreferences
    )
    nextPreferences = audio.state
    if (audio.track !== undefined) patch.currentAudioTrack = audio.track

    const subtitle = reconcileSubtitleSelection(
      subtitleTracks,
      snapshot.sid ? trackId(MPV_SUBTITLE_PREFIX, snapshot.sid) : null,
      store,
      nextPreferences
    )
    nextPreferences = subtitle.state
    if (subtitle.track !== undefined) patch.currentSubtitleTrack = subtitle.track
    disableMpvSubtitles = subtitle.disableEngineSubtitles
  }

  const qualityOptions = buildMpvVideoQualityOptions(snapshot.tracks.filter((track) => track.type === 'video'))
  if (!sameQualityOptions(store.videoQualityOptions, qualityOptions)) patch.videoQualityOptions = qualityOptions
  const activeQuality = getActiveMpvVideoQualityId(selectedVideoTrackId(snapshot))
  if (store.activeVideoQuality !== activeQuality) patch.activeVideoQuality = activeQuality
  const selectedQuality = normalizeVideoQualitySelection(qualityOptions, store.currentVideoQuality)
  if (store.currentVideoQuality !== selectedQuality) patch.currentVideoQuality = selectedQuality

  return { patch, preferences: nextPreferences, disableMpvSubtitles }
}
