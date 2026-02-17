import type { StateCreator } from 'zustand'
import type { AudioTrack, SubtitleTrack, SubtitleCue } from '@/types/player'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'

export interface PlayerSlice {
  playbackEngine: 'html5' | 'mpv'
  currentChannel: Channel | null
  isPlaying: boolean
  isPaused: boolean
  isBuffering: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  isPiP: boolean
  playerError: string | null
  audioTracks: AudioTrack[]
  currentAudioTrack: string | null
  subtitleTracks: SubtitleTrack[]
  currentSubtitleTrack: string | null
  subtitleCues: SubtitleCue[]
  activeSubtitleCues: SubtitleCue[]
  showControls: boolean
  isMiniPlayer: boolean
  setPlaybackEngine: (engine: 'html5' | 'mpv') => void
  playChannel: (channel: Channel) => void
  stopPlayback: () => void
  setPlaying: (playing: boolean) => void
  setPaused: (paused: boolean) => void
  setBuffering: (buffering: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setFullscreen: (fullscreen: boolean) => void
  setPiP: (pip: boolean) => void
  setPlayerError: (error: string | null) => void
  setAudioTracks: (tracks: AudioTrack[]) => void
  setCurrentAudioTrack: (id: string | null) => void
  setSubtitleTracks: (tracks: SubtitleTrack[]) => void
  setCurrentSubtitleTrack: (id: string | null) => void
  setSubtitleCues: (cues: SubtitleCue[]) => void
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
  setShowControls: (show: boolean) => void
  setMiniPlayer: (mini: boolean) => void
}

export const createPlayerSlice: StateCreator<PlayerSlice, [], [], PlayerSlice> = (set) => ({
  playbackEngine: 'html5',
  currentChannel: null,
  isPlaying: false,
  isPaused: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  isMuted: false,
  isFullscreen: false,
  isPiP: false,
  playerError: null,
  audioTracks: [],
  currentAudioTrack: null,
  subtitleTracks: [],
  currentSubtitleTrack: null,
  subtitleCues: [],
  activeSubtitleCues: [],
  showControls: true,
  isMiniPlayer: false,
  setPlaybackEngine: (engine) => set({ playbackEngine: engine }),

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
          playerError: 'Secilen icerik dogrudan oynatilamiyor.'
        }
      }

      return {
        currentChannel: channel,
        isPlaying: true,
        isPaused: false,
        playerError: null,
        currentTime: 0,
        duration: 0,
        audioTracks: [],
        currentAudioTrack: null,
        subtitleTracks: [],
        currentSubtitleTrack: null,
        subtitleCues: [],
        activeSubtitleCues: []
      }
    }),

  stopPlayback: () =>
    set({
      currentChannel: null,
      isPlaying: false,
      isPaused: false,
      isBuffering: false,
      currentTime: 0,
      duration: 0,
      playerError: null,
      audioTracks: [],
      currentAudioTrack: null,
      subtitleTracks: [],
      currentSubtitleTrack: null,
      subtitleCues: [],
      activeSubtitleCues: []
    }),

  setPlaying: (playing) => set({ isPlaying: playing }),
  setPaused: (paused) => set({ isPaused: paused }),
  setBuffering: (buffering) => set({ isBuffering: buffering }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  setMuted: (muted) => set({ isMuted: muted }),
  setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setPiP: (pip) => set({ isPiP: pip }),
  setPlayerError: (error) => set({ playerError: error }),
  setAudioTracks: (tracks) => set({ audioTracks: tracks }),
  setCurrentAudioTrack: (id) => set({ currentAudioTrack: id }),
  setSubtitleTracks: (tracks) => set({ subtitleTracks: tracks }),
  setCurrentSubtitleTrack: (id) => set({ currentSubtitleTrack: id }),
  setSubtitleCues: (cues) => set({ subtitleCues: cues }),
  setActiveSubtitleCues: (cues) => set({ activeSubtitleCues: cues }),
  setShowControls: (show) => set({ showControls: show }),
  setMiniPlayer: (mini) => set({ isMiniPlayer: mini })
})
