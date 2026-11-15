import type { StateCreator } from 'zustand'
import type { AudioTrack, SubtitleTrack, SubtitleCue, VideoQualityOption } from '@/types/player'
import type { Channel } from '@/types/playlist'
import type { MpvPlaybackTuning } from '@/services/platform'
import { isPlayableChannel } from '@/services/playback'

export const DEFAULT_PLAYBACK_TUNING: MpvPlaybackTuning = {
  audioDelay: 0,
  subDelay: 0,
  speed: 1,
  aspectRatio: 'auto'
}

type PlayerPatch = Partial<{
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
}>

function sameSubtitleCues(a: SubtitleCue[], b: SubtitleCue[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((cue, index) => {
    const other = b[index]
    return (
      cue === other ||
      (cue.startTime === other.startTime &&
        cue.endTime === other.endTime &&
        cue.text === other.text &&
        cue.style === other.style)
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
  playerNotice: null
} satisfies Partial<PlayerSlice>

export interface PlayerSlice {
  playbackEngine: 'html5' | 'mpv'
  currentChannel: Channel | null
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
   * Stream awaiting a resume seek, armed by the actions that start a stream
   * from scratch (play, reload, and suspend — the mini player does not keep
   * playing, so expanding it loads the stream again).
   */
  pendingResumeStreamUrl: string | null
  /**
   * Bumped by `reloadPlayback`. Both engines' load paths depend on it, so the
   * same channel can be loaded again without pretending it is a new one.
   */
  playbackReloadToken: number
  /**
   * The player route was left while something was selected. Neither engine
   * runs in that state (mpv is stopped, the <video> is unmounted): the mini
   * card shows the item as paused and expanding it starts it again.
   */
  isPlaybackSuspended: boolean
  /** The viewer picked the subtitle track (or "off") for the current stream. */
  isSubtitleTrackUserChoice: boolean
  /** Short, non-fatal message shown over the player (e.g. incomplete subtitles). */
  playerNotice: string | null
  showControls: boolean
  isMiniPlayer: boolean
  isPlayerSidebarOpen: boolean
  setPlaybackEngine: (engine: 'html5' | 'mpv') => void
  setPlaybackTuning: (patch: Partial<MpvPlaybackTuning>) => void
  resetPlaybackTuning: () => void
  playChannel: (channel: Channel) => void
  stopPlayback: () => void
  reloadPlayback: () => void
  suspendPlayback: () => void
  resumeSuspendedPlayback: () => void
  clearPendingResume: () => void
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

export const createPlayerSlice: StateCreator<PlayerSlice, [], [], PlayerSlice> = (set) => ({
  playbackEngine: 'html5',
  currentChannel: null,
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
  pendingResumeStreamUrl: null,
  playbackReloadToken: 0,
  isPlaybackSuspended: false,
  isSubtitleTrackUserChoice: false,
  playerNotice: null,
  showControls: true,
  isMiniPlayer: false,
  isPlayerSidebarOpen: false,
  setPlaybackEngine: (engine) => set({ playbackEngine: engine }),

  setPlaybackTuning: (patch) =>
    set((state) => ({ playbackTuning: { ...state.playbackTuning, ...patch } })),
  resetPlaybackTuning: () => set({ playbackTuning: DEFAULT_PLAYBACK_TUNING }),

  playChannel: (channel) =>
    set((state) => {
      if (!isPlayableChannel(channel)) {
        return {
          ...state,
          currentChannel: null,
          isPlaying: false,
          isPaused: false,
          isBuffering: false,
          currentTime: 0,
          duration: 0,
          pendingResumeStreamUrl: null,
          playerError: 'Seçilen içerik doğrudan oynatılamıyor.'
        }
      }

      return {
        ...EMPTY_STREAM_STATE,
        currentChannel: channel,
        isPlaying: true,
        isPaused: false,
        isPlaybackSuspended: false,
        // Live has no position to return to; everything else may.
        pendingResumeStreamUrl: channel.type === 'live' ? null : channel.streamUrl,
        // A lip-sync offset that fixed the previous broadcast is wrong for this
        // one, so corrections never carry across a channel change.
        playbackTuning: DEFAULT_PLAYBACK_TUNING
      }
    }),

  stopPlayback: () =>
    set({
      ...EMPTY_STREAM_STATE,
      currentChannel: null,
      isPlaying: false,
      isPaused: false,
      playbackTuning: DEFAULT_PLAYBACK_TUNING,
      pendingResumeStreamUrl: null,
      isPlaybackSuspended: false,
      isPlayerSidebarOpen: false
    }),

  // Same channel, same selections: only the engines start over. Position and
  // duration are zeroed so a resume waits for the fresh load instead of firing
  // on the stale duration.
  reloadPlayback: () =>
    set((state) => {
      if (!state.currentChannel) return state
      return {
        playbackReloadToken: state.playbackReloadToken + 1,
        playerError: null,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        demuxerCacheDuration: 0,
        pendingResumeStreamUrl:
          state.currentChannel.type === 'live' ? null : state.currentChannel.streamUrl
      }
    }),

  suspendPlayback: () =>
    set((state) => {
      if (!state.currentChannel || state.isPlaybackSuspended) return state
      return {
        ...EMPTY_STREAM_STATE,
        isPlaying: false,
        isPaused: true,
        isPlaybackSuspended: true,
        // Coming back starts the stream again, so a film or episode has to be
        // put back where it was. Live simply restarts.
        pendingResumeStreamUrl:
          state.currentChannel.type === 'live' ? null : state.currentChannel.streamUrl
      }
    }),

  resumeSuspendedPlayback: () =>
    set((state) => (state.isPlaybackSuspended ? { isPlaybackSuspended: false } : state)),

  clearPendingResume: () => set({ pendingResumeStreamUrl: null }),

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
