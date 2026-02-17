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

export interface PlayerState {
  isPlaying: boolean
  isPaused: boolean
  isBuffering: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  isPiP: boolean
  error: string | null
  audioTracks: AudioTrack[]
  currentAudioTrack: string | null
  subtitleTracks: SubtitleTrack[]
  currentSubtitleTrack: string | null
  subtitleCues: SubtitleCue[]
}
