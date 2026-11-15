/**
 * The one IPC contract between main, preload and renderer.
 *
 * Every channel name and payload type lives here. Main registers handlers
 * against `IpcInvokeContract`, preload builds `window.electron` from the method
 * table in `./api`, and the renderer's wrappers call through that table — so a
 * channel that exists on one side and not the other is a type error.
 */
import type {
  AppUpdateState,
  EmbeddedSubtitleExtractionResult,
  EmbeddedSubtitleProbeTrack,
  MpvPlaybackTuning,
  MpvStateSnapshot,
  MpvSubtitleStyle,
  SecureXtreamCredentials
} from '../types/electron-ipc'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface PickedFile {
  path: string
  content: string
}

/** Files read for the renderer (playlists, subtitles) are capped at this size. */
export const MAX_LOCAL_FILE_SIZE_BYTES = 25 * 1024 * 1024

export type SecureCredentialMap = Record<string, SecureXtreamCredentials>

/**
 * Sent when the encrypted credential file could not be read and was moved
 * aside. The stored passwords are gone from the app's point of view; the user
 * has to log in to those sources again.
 */
export interface SecureCredentialsLossNotice {
  lostAt: number
  reason: 'decrypt-failed' | 'corrupt'
  /** File name (not full path) the unreadable file was renamed to, if the rename worked. */
  quarantinedAs: string | null
}

/**
 * Optional controls for an ffprobe/ffmpeg run. A renderer-chosen `jobId` lets
 * the caller cancel the run before it finishes; without one main assigns an id
 * the caller never sees, and the run can still be cancelled with
 * `cancelMediaJob()` (no argument = every job this window started).
 */
export interface MediaJobOptions {
  jobId?: string
  /** Upper bound for the run; clamped to 1–45 seconds. */
  timeoutMs?: number
}

/** Message of the error a cancelled probe/extraction rejects with. */
export const MEDIA_JOB_CANCELLED_MESSAGE = 'Medya işi iptal edildi'

export interface WindowStateInfo {
  isMaximized: boolean
  isFullScreen: boolean
}

type Invoke<Args extends unknown[], Result> = { args: Args; result: Result }

export interface IpcInvokeContract {
  'pick-file-content': Invoke<[filters?: FileFilter[]], PickedFile | null>
  'read-picked-file': Invoke<[filePath: string], PickedFile>

  'secure-credentials-get-all': Invoke<[], SecureCredentialMap>
  'secure-credentials-set': Invoke<[sourceId: string, credential: SecureXtreamCredentials], void>
  'secure-credentials-delete': Invoke<[sourceId: string], void>
  'secure-credentials-get-loss': Invoke<[], SecureCredentialsLossNotice | null>

  'embedded-subtitles-probe': Invoke<
    [streamUrl: string, options?: MediaJobOptions],
    EmbeddedSubtitleProbeTrack[]
  >
  'embedded-subtitles-extract': Invoke<
    [streamUrl: string, streamIndex: number, options?: MediaJobOptions],
    EmbeddedSubtitleExtractionResult | null
  >
  'media-job-cancel': Invoke<[jobId?: string], boolean>

  'mpv-is-available': Invoke<[], boolean>
  'mpv-open': Invoke<[streamUrl: string], void>
  'mpv-stop': Invoke<[], void>
  'mpv-toggle-pause': Invoke<[], void>
  'mpv-set-pause': Invoke<[paused: boolean], void>
  'mpv-seek': Invoke<[seconds: number], void>
  'mpv-seek-to': Invoke<[seconds: number], void>
  'mpv-jump-to-live': Invoke<[], void>
  'mpv-set-volume': Invoke<[normalizedVolume: number], void>
  'mpv-set-mute': Invoke<[muted: boolean], void>
  'mpv-set-video-track': Invoke<[trackId: number | null], void>
  'mpv-set-audio-track': Invoke<[trackId: number | null], void>
  'mpv-set-subtitle-track': Invoke<[trackId: number | null], void>
  'mpv-add-subtitle-file': Invoke<[filePath: string], number | null>
  'mpv-set-fullscreen': Invoke<[fullscreen: boolean], void>
  'mpv-set-hardware-decoding': Invoke<[enabled: boolean], void>
  'mpv-set-audio-passthrough': Invoke<[enabled: boolean], void>
  'mpv-set-subtitle-style': Invoke<[style: MpvSubtitleStyle], void>
  'mpv-set-playback-tuning': Invoke<[tuning: MpvPlaybackTuning], void>
  'mpv-set-video-margin': Invoke<[right: number], void>
  'mpv-get-state': Invoke<[], MpvStateSnapshot>

  'display-sleep-set-prevented': Invoke<[prevented: boolean], void>

  'window-minimize': Invoke<[], void>
  'window-maximize': Invoke<[], void>
  'window-close': Invoke<[], void>
  'window-set-fullscreen': Invoke<[fullscreen: boolean], void>
  'window-is-fullscreen': Invoke<[], boolean>
  'window-get-state': Invoke<[], WindowStateInfo>

  'app-update-get-state': Invoke<[], AppUpdateState>
  'app-update-check': Invoke<[], AppUpdateState>
  'app-update-install': Invoke<[], boolean>
  'store-backup-read': Invoke<[], string | null>
  'store-backup-delete': Invoke<[], void>
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args']
export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result']

/** Main → renderer pushes. */
export interface IpcEventContract {
  'app-update-state': AppUpdateState
  'window-state-changed': WindowStateInfo
  'secure-credentials-lost': SecureCredentialsLossNotice
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C]
