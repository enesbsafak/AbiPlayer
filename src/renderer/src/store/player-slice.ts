import type { StateCreator } from 'zustand'
import type { AudioTrack, SubtitleTrack, SubtitleCue } from '@/types/player'
import type { Channel } from '@/types/playlist'

export interface PlayerSlice {
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
  currentAudioTrack: number
  subtitleTracks: SubtitleTrack[]
  currentSubtitleTrack: string | null
  subtitleCues: SubtitleCue[]
  activeSubtitleCues: SubtitleCue[]
  showControls: boolean
  isMiniPlayer: boolean
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
  setCurrentAudioTrack: (id: number) => void
  setSubtitleTracks: (tracks: SubtitleTrack[]) => void
  setCurrentSubtitleTrack: (id: string | null) => void
  setSubtitleCues: (cues: SubtitleCue[]) => void
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
  setShowControls: (show: boolean) => void
  setMiniPlayer: (mini: boolean) => void
}

export const createPlayerSlice: StateCreator<PlayerSlice, [], [], PlayerSlice> = (set) => ({
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
  currentAudioTrack: -1,
  subtitleTracks: [],
  currentSubtitleTrack: null,
  subtitleCues: [],
  activeSubtitleCues: [],
  showControls: true,
  isMiniPlayer: false,

  playChannel: (channel) =>
    set({
      currentChannel: channel,
      isPlaying: true,
      isPaused: false,
      playerError: null,
      currentTime: 0,
      duration: 0,
      audioTracks: [],
      currentAudioTrack: -1,
      subtitleTracks: [],
      currentSubtitleTrack: null,
      subtitleCues: [],
      activeSubtitleCues: []
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
      subtitleTracks: [],
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
