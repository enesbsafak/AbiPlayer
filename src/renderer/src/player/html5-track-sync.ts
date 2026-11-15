import type Hls from 'hls.js'
import type { AudioTrack, SubtitleCue, SubtitleTrack, VideoQualityOption } from '@/types/player'
import type { PlayerPatch } from '@/store/player-slice'
import { buildVideoQualityOptions, getActiveVideoQualityId } from '@/services/quality'
import {
  applyHlsSubtitleTrack,
  attachCueListeners,
  collectHlsAudioTracks,
  collectHlsSubtitleTracks,
  collectNativeAudioTracks,
  collectNativeSubtitleTracks,
  mergeHtml5SubtitleTracks,
  syncActiveSubtitleCues
} from './html5-tracks'
import { HLS_SUBTITLE_PREFIX, trackIndex } from './track-ids'
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

/** The slice of the player store the HTML5 track sync reads. */
export interface Html5TrackStoreView extends TrackSelectionContext {
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  videoQualityOptions: VideoQualityOption[]
  currentVideoQuality: string | null
  activeVideoQuality: string | null
}

export interface Html5TrackSyncDeps {
  video: HTMLVideoElement
  getHls: () => Hls | null
  /** Subtitle streams the probe found for this playback (direct files). */
  getProbedTracks: () => SubtitleTrack[]
  getStore: () => Html5TrackStoreView
  applyPlayerPatch: (patch: PlayerPatch) => void
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
  /** Per item; survives reloads of it. */
  preferences: { current: TrackPreferenceState }
}

/**
 * Publishes the track lists of one HTML5 playback to the store and keeps the
 * selections valid, through the same reconciler mpv uses.
 */
export function createHtml5TrackSync(deps: Html5TrackSyncDeps) {
  const { video, applyPlayerPatch, setActiveSubtitleCues, preferences } = deps

  const refreshAudioTracks = (hls: Hls | null = deps.getHls()): void => {
    const hlsTracks = hls ? collectHlsAudioTracks(hls) : []
    const tracks = hlsTracks.length > 0 ? hlsTracks : collectNativeAudioTracks(video)
    const store = deps.getStore()
    const result = reconcileAudioSelection(tracks, null, store, preferences.current)
    preferences.current = result.state

    const patch: PlayerPatch = {}
    if (!sameAudioTracks(store.audioTracks, tracks)) patch.audioTracks = tracks
    if (result.track !== undefined) patch.currentAudioTrack = result.track
    if (Object.keys(patch).length > 0) applyPlayerPatch(patch)
  }

  const refreshSubtitleTracks = (hls: Hls | null = deps.getHls()): void => {
    const tracks = mergeHtml5SubtitleTracks(
      hls ? collectHlsSubtitleTracks(hls) : [],
      collectNativeSubtitleTracks(video),
      deps.getProbedTracks()
    )
    const store = deps.getStore()
    const result = reconcileSubtitleSelection(tracks, null, store, preferences.current)
    preferences.current = result.state

    const patch: PlayerPatch = {}
    if (!sameSubtitleTracks(store.subtitleTracks, tracks)) patch.subtitleTracks = tracks
    if (result.track !== undefined) {
      patch.currentSubtitleTrack = result.track
      if (result.track === null) {
        patch.subtitleCues = []
        patch.activeSubtitleCues = []
      }
    }
    if (Object.keys(patch).length > 0) applyPlayerPatch(patch)
  }

  const refreshVideoQualities = (hls: Hls | null = deps.getHls()): void => {
    const options = hls ? buildVideoQualityOptions(hls.levels) : []
    const store = deps.getStore()
    const selected = normalizeVideoQualitySelection(options, store.currentVideoQuality)
    const active = hls ? getActiveVideoQualityId(hls.currentLevel) : null

    const patch: PlayerPatch = {}
    if (!sameQualityOptions(store.videoQualityOptions, options)) patch.videoQualityOptions = options
    if (store.currentVideoQuality !== selected) patch.currentVideoQuality = selected
    if (store.activeVideoQuality !== active) patch.activeVideoQuality = active
    if (Object.keys(patch).length > 0) applyPlayerPatch(patch)
  }

  /** hls.js recreates its text tracks; point the selected one at the new element track. */
  const syncHlsSubtitleSelection = (): void => {
    const index = trackIndex(deps.getStore().currentSubtitleTrack, HLS_SUBTITLE_PREFIX)
    const hls = deps.getHls()
    if (index === null || !hls) return
    applyHlsSubtitleTrack(video, hls, index, setActiveSubtitleCues)
  }

  return {
    refreshAudioTracks,
    refreshSubtitleTracks,
    refreshVideoQualities,
    syncHlsSubtitleSelection,
    /** Tracks may be known now (loadeddata, canplay). */
    refreshMediaTracks(): void {
      refreshAudioTracks()
      refreshSubtitleTracks()
    },
    /** The element's text track list changed. */
    onTextTracksChanged(): void {
      refreshSubtitleTracks()
      attachCueListeners(video, setActiveSubtitleCues)
      syncHlsSubtitleSelection()
      syncActiveSubtitleCues(video, setActiveSubtitleCues)
    }
  }
}

export type Html5TrackSync = ReturnType<typeof createHtml5TrackSync>
