import type { StateCreator } from 'zustand'
import type {
  AudioTrack,
  CurrentPlayback,
  EpisodePlaybackRequest,
  PendingResume,
  PlaybackRequest,
  SubtitleTrack,
  SubtitleCue,
  VideoQualityOption
} from '@/types/player'
import type { Channel } from '@/types/playlist'
import type { MpvPlaybackTuning } from '@/services/platform'
import {
  resolveStreamUrl,
  streamUrlContextFor,
  targetFromChannel,
  type PlaybackSourceState
} from '@/services/playback'
import {
  createPlaybackId,
  episodeTarget,
  isPlayableTarget,
  isTrackableTarget,
  mediaKey,
  type PlayableTarget,
  type PlaybackId
} from '../../../shared/playback'
import { EXTERNAL_SUBTITLE_ID } from '@/player/track-ids'

export const DEFAULT_PLAYBACK_TUNING: MpvPlaybackTuning = {
  audioDelay: 0,
  subDelay: 0,
  speed: 1,
  aspectRatio: 'auto'
}

export type PlayerPatch = Partial<{
  playbackEngine: 'html5' | 'mpv'
  isPlaying: boolean
  isPaused: boolean
  isBuffering: boolean
  currentTime: number
  duration: number
  demuxerCacheDuration: number
  isFullscreen: boolean
  playerError: string | null
  passthroughActive: boolean
  audioTracks: AudioTrack[]
  currentAudioTrack: string | null
  subtitleTracks: SubtitleTrack[]
  currentSubtitleTrack: string | null
  videoQualityOptions: VideoQualityOption[]
  currentVideoQuality: string | null
  activeVideoQuality: string | null
  subtitleCues: SubtitleCue[]
  activeSubtitleCues: SubtitleCue[]
  playerNotice: string | null
  loadedPlaybackId: PlaybackId | null
  externalSubtitle: ExternalSubtitleFile | null
}>

/**
 * A subtitle file the viewer loaded into mpv for one item. mpv adds it to the
 * file being played (`sub-add`), so a new load of the same item (a reconnect,
 * a reload, the return from the mini card) does not have it; the engine adds
 * it again from here. `trackId` is its store id in the current load.
 */
export interface ExternalSubtitleFile {
  mediaKey: string
  path: string
  trackId: string
}

function sameSubtitleCues(a: SubtitleCue[], b: SubtitleCue[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((cue, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      (cue === other ||
      (cue.startTime === other.startTime &&
        cue.endTime === other.endTime &&
        cue.text === other.text &&
        cue.style === other.style))
    )
  })
}

/** Everything that describes the stream currently loaded into an engine. */
const EMPTY_STREAM_STATE = {
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  demuxerCacheDuration: 0,
  playerError: null,
  audioTracks: [],
  currentAudioTrack: null,
  subtitleTracks: [],
  currentSubtitleTrack: null,
  isSubtitleTrackUserChoice: false,
  videoQualityOptions: [],
  currentVideoQuality: null,
  activeVideoQuality: null,
  subtitleCues: [],
  activeSubtitleCues: [],
  playerNotice: null,
  loadedPlaybackId: null,
  externalSubtitle: null
} satisfies Partial<PlayerSlice>

/**
 * What the viewer chose for the item (audio, subtitle or "off", a loaded
 * subtitle file). Kept by every new load of the same item: a reload, a
 * reconnect and a return from the mini card. The engines push it back once
 * the new load's tracks are known.
 */
function viewerSelections(state: PlayerSlice): Partial<PlayerSlice> {
  return {
    currentAudioTrack: state.currentAudioTrack,
    currentSubtitleTrack: state.currentSubtitleTrack,
    isSubtitleTrackUserChoice: state.isSubtitleTrackUserChoice,
    externalSubtitle: state.externalSubtitle,
    // Parsed cues of a file loaded into the HTML5 engine are the file itself.
    ...(state.currentSubtitleTrack === EXTERNAL_SUBTITLE_ID ? { subtitleCues: state.subtitleCues } : {})
  }
}

const NOT_PLAYABLE_MESSAGE = 'Seçilen içerik doğrudan oynatılamıyor.'

function armResume(playback: CurrentPlayback): PendingResume | null {
  if (!isTrackableTarget(playback.target)) return null
  return {
    playbackId: playback.playbackId,
    mediaKey: playback.mediaKey,
    phase: 'awaiting-load',
    position: null
  }
}

/** The episode as the player UI shows it. Its id is stable, not a timestamp. */
export function episodeDisplayChannel(request: EpisodePlaybackRequest): Channel {
  return {
    id: `${request.sourceId}_episode_${request.episodeId}`,
    name: request.title,
    streamUrl: request.fallbackStreamUrl ?? '',
    sourceId: request.sourceId,
    // The player treats an episode like a film (seekable, resumable).
    type: 'vod',
    ...(request.coverUrl ? { coverUrl: request.coverUrl } : {})
  }
}

export interface PlayerSlice {
  playbackEngine: 'html5' | 'mpv'
  /** What the UI shows for the current item. Identity lives in `currentPlayback`. */
  currentChannel: Channel | null
  /**
   * The current playback intent: a fresh `playbackId` per start, deliberate
   * reload and return from the mini card, the target and its media key, and the
   * URL resolved for it. "Is this still the same stream?" is answered by
   * comparing `playbackId` (this attempt) or `mediaKey` (this item), never URLs.
   */
  currentPlayback: CurrentPlayback | null
  /**
   * Set by the engine once the stream of that playback is open far enough to
   * seek (a snapshot of that playback reports it loaded, the `<video>` has metadata).
   */
  loadedPlaybackId: PlaybackId | null
  isPlaying: boolean
  isPaused: boolean
  isBuffering: boolean
  currentTime: number
  duration: number
  demuxerCacheDuration: number
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  isPiP: boolean
  playerError: string | null
  /** Reported by mpv: passthrough is on AND the audio device accepted it. */
  passthroughActive: boolean
  audioTracks: AudioTrack[]
  currentAudioTrack: string | null
  subtitleTracks: SubtitleTrack[]
  currentSubtitleTrack: string | null
  videoQualityOptions: VideoQualityOption[]
  currentVideoQuality: string | null
  activeVideoQuality: string | null
  subtitleCues: SubtitleCue[]
  activeSubtitleCues: SubtitleCue[]
  /** Session-scoped lip-sync / speed / aspect corrections; reset per channel. */
  playbackTuning: MpvPlaybackTuning
  /**
   * Resume seek still owed to a playback, armed by the actions that start a
   * stream from scratch (play, reload, and suspend: the mini player does not
   * keep playing, so expanding it loads the stream again). Cleared only once
   * the seek for that very playback has been carried out (`completeResume`).
   */
  pendingResume: PendingResume | null
  /**
   * Bumped by `reloadPlayback`, which also issues a new playback id. Kept for
   * code that only needs to know "a reload happened".
   */
  playbackReloadToken: number
  /**
   * The player route was left while something was selected. Neither engine
   * runs in that state (mpv is stopped, the <video> is unmounted): the mini
   * card shows the item as paused and expanding it starts it again.
   */
  isPlaybackSuspended: boolean
  /**
   * Experimental (setting `keepPlayingInCorner`, mpv only): the player route
   * was left and mpv keeps playing the current playback in a corner of the
   * window. Never true together with `isPlaybackSuspended`.
   */
  isCornerPlayback: boolean
  /** The viewer picked the subtitle track (or "off") for the current stream. */
  isSubtitleTrackUserChoice: boolean
  /** The subtitle file the viewer loaded into mpv for the current item. */
  externalSubtitle: ExternalSubtitleFile | null
  /** Short, non-fatal message shown over the player (e.g. incomplete subtitles). */
  playerNotice: string | null
  showControls: boolean
  isMiniPlayer: boolean
  isPlayerSidebarOpen: boolean
  setPlaybackEngine: (engine: 'html5' | 'mpv') => void
  setPlaybackTuning: (patch: Partial<MpvPlaybackTuning>) => void
  resetPlaybackTuning: () => void
  /** Starts a target; `channel` is what the UI shows for it. */
  startPlayback: (request: PlaybackRequest) => void
  /** Starts a catalog item; the target is derived from the channel. */
  playChannel: (channel: Channel) => void
  /** Starts one series episode with a real episode target. */
  playEpisode: (request: EpisodePlaybackRequest) => void
  stopPlayback: () => void
  reloadPlayback: () => void
  suspendPlayback: () => void
  resumeSuspendedPlayback: () => void
  /**
   * The player route is being left: suspend the playback, or, with the
   * experimental corner setting on and mpv as the engine, keep it playing in
   * the corner.
   */
  leavePlayerRoute: () => void
  /** The player route is shown again: a corner playback goes back to full size, unchanged. */
  returnFromCornerPlayback: () => void
  /** Engine report: the stream of `playbackId` is open far enough to seek. */
  markPlaybackLoaded: (playbackId: PlaybackId) => void
  /** The resume seek for `playbackId` was sent to the engine. */
  markResumeSeekIssued: (playbackId: PlaybackId, position: number) => void
  /** The resume for `playbackId` is done (seek carried out, or nothing to resume). */
  completeResume: (playbackId: PlaybackId) => void
  setPlaying: (playing: boolean) => void
  setPaused: (paused: boolean) => void
  setBuffering: (buffering: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setDemuxerCacheDuration: (seconds: number) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setFullscreen: (fullscreen: boolean) => void
  setPiP: (pip: boolean) => void
  setPlayerError: (error: string | null) => void
  setAudioTracks: (tracks: AudioTrack[]) => void
  setCurrentAudioTrack: (id: string | null) => void
  setSubtitleTracks: (tracks: SubtitleTrack[]) => void
  setCurrentSubtitleTrack: (id: string | null) => void
  /** A subtitle choice made by the viewer; engines must not override it. */
  selectSubtitleTrack: (id: string | null) => void
  setPlayerNotice: (notice: string | null) => void
  setVideoQualityOptions: (options: VideoQualityOption[]) => void
  setCurrentVideoQuality: (id: string | null) => void
  setActiveVideoQuality: (id: string | null) => void
  setSubtitleCues: (cues: SubtitleCue[]) => void
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
  setShowControls: (show: boolean) => void
  setMiniPlayer: (mini: boolean) => void
  setPlayerSidebarOpen: (open: boolean) => void
  togglePlayerSidebar: () => void
  applyPlayerPatch: (patch: PlayerPatch) => void
}

type PlayerSliceState = PlayerSlice &
  PlaybackSourceState & { settings?: { keepPlayingInCorner?: boolean } }

/** Whether leaving the player route keeps the playback running in the corner. */
export function shouldKeepPlayingInCorner(
  state: Pick<PlayerSliceState, 'settings' | 'playbackEngine' | 'currentPlayback' | 'isPlaybackSuspended'>
): boolean {
  return (
    state.settings?.keepPlayingInCorner === true &&
    state.playbackEngine === 'mpv' &&
    state.currentPlayback !== null &&
    !state.isPlaybackSuspended
  )
}

function failedStart(): Partial<PlayerSlice> {
  return {
    currentChannel: null,
    currentPlayback: null,
    loadedPlaybackId: null,
    isPlaying: false,
    isPaused: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    pendingResume: null,
    playerError: NOT_PLAYABLE_MESSAGE
  }
}

function resolveFor(
  target: PlayableTarget,
  channel: Channel,
  state: PlaybackSourceState
): string | null {
  const stored = channel.streamUrl
  return resolveStreamUrl(
    target,
    streamUrlContextFor(target, state, { entryUrl: stored, fallbackUrl: stored })
  )
}

function startState(state: PlayerSliceState, request: PlaybackRequest): Partial<PlayerSlice> {
  const { target, channel } = request
  if (!isPlayableTarget(target)) return failedStart()
  const streamUrl = resolveFor(target, channel, state)
  if (!streamUrl) return failedStart()

  const playback: CurrentPlayback = {
    playbackId: createPlaybackId(),
    target,
    mediaKey: mediaKey(target),
    streamUrl
  }
  return {
    ...EMPTY_STREAM_STATE,
    currentChannel: channel,
    currentPlayback: playback,
    isPlaying: true,
    isPaused: false,
    isPlaybackSuspended: false,
    isCornerPlayback: false,
    // Live has no position to return to; everything else may.
    pendingResume: armResume(playback),
    // A lip-sync offset that fixed the previous broadcast is wrong for this
    // one, so corrections never carry across a channel change.
    playbackTuning: DEFAULT_PLAYBACK_TUNING
  }
}

function suspendState(state: PlayerSliceState): Partial<PlayerSlice> {
  if (!state.currentChannel || !state.currentPlayback || state.isPlaybackSuspended) return state
  return {
    ...EMPTY_STREAM_STATE,
    ...viewerSelections(state),
    isPlaying: false,
    isPaused: true,
    isPlaybackSuspended: true,
    isCornerPlayback: false,
    // Coming back starts the stream again, so a film or episode has to be
    // put back where it was. Live simply restarts.
    pendingResume: armResume(state.currentPlayback)
  }
}

export const createPlayerSlice: StateCreator<PlayerSliceState, [], [], PlayerSlice> = (set) => ({
  playbackEngine: 'html5',
  currentChannel: null,
  currentPlayback: null,
  loadedPlaybackId: null,
  isPlaying: false,
  isPaused: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  demuxerCacheDuration: 0,
  volume: 0.8,
  isMuted: false,
  isFullscreen: false,
  isPiP: false,
  playerError: null,
  passthroughActive: false,
  audioTracks: [],
  currentAudioTrack: null,
  subtitleTracks: [],
  currentSubtitleTrack: null,
  videoQualityOptions: [],
  currentVideoQuality: null,
  activeVideoQuality: null,
  subtitleCues: [],
  activeSubtitleCues: [],
  playbackTuning: DEFAULT_PLAYBACK_TUNING,
  pendingResume: null,
  playbackReloadToken: 0,
  isPlaybackSuspended: false,
  isCornerPlayback: false,
  isSubtitleTrackUserChoice: false,
  externalSubtitle: null,
  playerNotice: null,
  showControls: true,
  isMiniPlayer: false,
  isPlayerSidebarOpen: false,
  setPlaybackEngine: (engine) => set({ playbackEngine: engine }),

  setPlaybackTuning: (patch) =>
    set((state) => ({ playbackTuning: { ...state.playbackTuning, ...patch } })),
  resetPlaybackTuning: () => set({ playbackTuning: DEFAULT_PLAYBACK_TUNING }),

  startPlayback: (request) => set((state) => startState(state, request)),

  playChannel: (channel) =>
    set((state) => {
      const target = targetFromChannel(channel)
      return target ? startState(state, { target, channel }) : failedStart()
    }),

  playEpisode: (request) =>
    set((state) =>
      startState(state, {
        target: episodeTarget({
          sourceId: request.sourceId,
          episodeId: request.episodeId,
          containerExtension: request.containerExtension,
          seriesId: request.seriesId,
          season: request.season,
          episode: request.episodeNum
        }),
        channel: episodeDisplayChannel(request)
      })
    ),

  stopPlayback: () =>
    set({
      ...EMPTY_STREAM_STATE,
      currentChannel: null,
      currentPlayback: null,
      isPlaying: false,
      isPaused: false,
      playbackTuning: DEFAULT_PLAYBACK_TUNING,
      pendingResume: null,
      isPlaybackSuspended: false,
      isCornerPlayback: false,
      isPlayerSidebarOpen: false
    }),

  // Same item, same selections: only the engines start over, as a new
  // playback. Position and duration are zeroed so a resume waits for the fresh
  // load instead of firing on the stale duration.
  reloadPlayback: () =>
    set((state) => {
      const previous = state.currentPlayback
      if (!state.currentChannel || !previous) return state
      // Credentials may have changed since the start; keep the URL that was
      // in use if nothing can be derived now.
      const streamUrl = resolveFor(previous.target, state.currentChannel, state) ?? previous.streamUrl
      const playback: CurrentPlayback = { ...previous, playbackId: createPlaybackId(), streamUrl }
      return {
        currentPlayback: playback,
        loadedPlaybackId: null,
        playbackReloadToken: state.playbackReloadToken + 1,
        playerError: null,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        demuxerCacheDuration: 0,
        pendingResume: armResume(playback)
      }
    }),

  suspendPlayback: () => set(suspendState),

  leavePlayerRoute: () =>
    set((state) => {
      if (!shouldKeepPlayingInCorner(state)) return suspendState(state)
      // Same playback, still playing: nothing is reloaded and nothing is armed.
      return state.isCornerPlayback ? state : { isCornerPlayback: true, isPlayerSidebarOpen: false }
    }),

  returnFromCornerPlayback: () =>
    set((state) => (state.isCornerPlayback ? { isCornerPlayback: false } : state)),

  // Expanding the mini card loads the stream again: a new playback of the same
  // item, and the armed resume moves over to it.
  resumeSuspendedPlayback: () =>
    set((state) => {
      if (!state.isPlaybackSuspended) return state
      if (!state.currentPlayback) return { isPlaybackSuspended: false }
      const playback: CurrentPlayback = { ...state.currentPlayback, playbackId: createPlaybackId() }
      // Armed by the suspend, for this very item.
      const pending = state.pendingResume
      return {
        isPlaybackSuspended: false,
        currentPlayback: playback,
        loadedPlaybackId: null,
        pendingResume: pending
          ? { ...pending, playbackId: playback.playbackId, phase: 'awaiting-load', position: null }
          : null
      }
    }),

  markPlaybackLoaded: (playbackId) =>
    set((state) =>
      state.currentPlayback?.playbackId === playbackId && state.loadedPlaybackId !== playbackId
        ? { loadedPlaybackId: playbackId }
        : state
    ),

  markResumeSeekIssued: (playbackId, position) =>
    set((state) =>
      state.pendingResume?.playbackId === playbackId
        ? { pendingResume: { ...state.pendingResume, phase: 'seek-issued', position } }
        : state
    ),

  completeResume: (playbackId) =>
    set((state) => (state.pendingResume?.playbackId === playbackId ? { pendingResume: null } : state)),

  setPlaying: (playing) => set({ isPlaying: playing }),
  setPaused: (paused) => set({ isPaused: paused }),
  setBuffering: (buffering) => set({ isBuffering: buffering }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setDemuxerCacheDuration: (seconds) => set({ demuxerCacheDuration: seconds }),
  setVolume: (volume) => set({ volume }),
  setMuted: (muted) => set({ isMuted: muted }),
  setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setPiP: (pip) => set({ isPiP: pip }),
  setPlayerError: (error) => set({ playerError: error }),
  setAudioTracks: (tracks) => set({ audioTracks: tracks }),
  setCurrentAudioTrack: (id) => set({ currentAudioTrack: id }),
  setSubtitleTracks: (tracks) => set({ subtitleTracks: tracks }),
  setCurrentSubtitleTrack: (id) => set({ currentSubtitleTrack: id }),
  selectSubtitleTrack: (id) => set({ currentSubtitleTrack: id, isSubtitleTrackUserChoice: true }),
  setPlayerNotice: (notice) => set({ playerNotice: notice }),
  setVideoQualityOptions: (options) => set({ videoQualityOptions: options }),
  setCurrentVideoQuality: (id) => set({ currentVideoQuality: id }),
  setActiveVideoQuality: (id) => set({ activeVideoQuality: id }),
  setSubtitleCues: (cues) => set({ subtitleCues: cues }),
  // Called on every cue tick (up to 10x/s); an identical list must not wake
  // every subscriber.
  setActiveSubtitleCues: (cues) =>
    set((state) =>
      sameSubtitleCues(state.activeSubtitleCues, cues) ? state : { activeSubtitleCues: cues }
    ),
  setShowControls: (show) => set({ showControls: show }),
  setMiniPlayer: (mini) => set({ isMiniPlayer: mini }),
  setPlayerSidebarOpen: (open) => set({ isPlayerSidebarOpen: open }),
  togglePlayerSidebar: () => set((state) => ({ isPlayerSidebarOpen: !state.isPlayerSidebarOpen })),
  applyPlayerPatch: (patch) => set(patch)
})
