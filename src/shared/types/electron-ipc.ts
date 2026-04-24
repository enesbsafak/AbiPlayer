export interface MpvTrackInfo {
  id: number
  type: 'audio' | 'sub' | 'video'
  title?: string
  lang?: string
  codec?: string
  bitrate?: number
  width?: number
  height?: number
  selected: boolean
  external: boolean
}

export interface MpvStateSnapshot {
  available: boolean
  running: boolean
  paused: boolean
  buffering: boolean
  timePos: number
  duration: number
  demuxerCacheDuration: number
  volume: number
  muted: boolean
  vid: number | null
  aid: number | null
  sid: number | null
  fullscreen: boolean
  tracks: MpvTrackInfo[]
  path: string | null
  error: string | null
}

export interface MpvSubtitleStyle {
  fontSize: number
  color: string
  background: string
}

export type AppUpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  progress: number | null
  transferredBytes: number | null
  totalBytes: number | null
  bytesPerSecond: number | null
  message: string | null
  releaseDate: string | null
  canCheck: boolean
  updateReadyToInstall: boolean
  lastCheckedAt: number | null
}

export interface EmbeddedSubtitleProbeTrack {
  index: number
  codec: string
  language?: string
  title?: string
}

export interface EmbeddedSubtitleExtractionResult {
  format: 'vtt'
  content: string
}

export interface SecureXtreamCredentials {
  url: string
  username: string
  password: string
}