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

/** What the renderer hands mpv along with the URL of a playback. */
export interface MpvOpenRequest {
  /** The renderer's id for this playback; every snapshot about it carries it back. */
  playbackId: string
  /**
   * Tuning for this playback. Omitted on a reconnect of the same playback,
   * which keeps what mpv already has.
   */
  tuning?: MpvPlaybackTuning
}

/** A rectangle of the window's content area in CSS pixels (the corner player's picture). */
export interface MpvVideoRect {
  left: number
  top: number
  width: number
  height: number
}

/** Why a server certificate failed verification, in the user's terms. */
export type CertificateProblem = 'authority' | 'expired' | 'not-yet-valid' | 'name-mismatch' | 'other'

/** Which part of the app met the certificate: Chromium requests, mpv, or ffprobe/ffmpeg. */
export type CertificateFailureContext = 'network' | 'playback' | 'media'

export interface CertificateSummary {
  /** SHA-256 of the DER certificate: upper-case hex pairs joined by ':'. */
  fingerprint256: string
  subject: string
  issuer: string
  /** ISO 8601. */
  validFrom: string
  validTo: string
}

/**
 * A server presented a certificate the app does not accept. `host` is
 * lower-case ASCII (IDN in punycode, IPv6 without brackets); `port` is the
 * real port (443 when the URL had none).
 */
export interface UntrustedCertificateNotice extends CertificateSummary {
  host: string
  port: number
  problems: CertificateProblem[]
  /** Engine error code, e.g. net::ERR_CERT_AUTHORITY_INVALID. */
  error: string
  context: CertificateFailureContext
  /** A different certificate was trusted for this host and port before. */
  changed: boolean
  seenAt: number
}

/** A host and port the user agreed to trust, pinned to one certificate. */
export interface TrustedCertificateHost extends CertificateSummary {
  host: string
  port: number
  problems: CertificateProblem[]
  /** Sources the trust was given for; empty when given while a source was being added. */
  sourceIds: string[]
  trustedAt: number
}

export interface CertificateTrustRequest {
  host: string
  port: number
  /** Must be the fingerprint main last saw for this host and port. */
  fingerprint256: string
  sourceId?: string
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
  'mpv-open': Invoke<[streamUrl: string, request: MpvOpenRequest], void>
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
  /** Confines the picture to `rect`; null gives it the whole window again. */
  'mpv-set-video-rect': Invoke<[rect: MpvVideoRect | null], void>
  'mpv-get-state': Invoke<[], MpvStateSnapshot>
  /**
   * Starts pushing `mpv-state` to the calling window (idempotent) and returns
   * the current snapshot, so a subscriber never starts from nothing.
   */
  'mpv-subscribe': Invoke<[], MpvStateSnapshot>
  'mpv-unsubscribe': Invoke<[], void>

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

  'tls-list-trusted': Invoke<[], TrustedCertificateHost[]>
  'tls-list-untrusted': Invoke<[], UntrustedCertificateNotice[]>
  'tls-trust': Invoke<[request: CertificateTrustRequest], TrustedCertificateHost>
  'tls-revoke': Invoke<[host: string, port: number], boolean>
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args']
export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result']

/** Main → renderer pushes. */
export interface IpcEventContract {
  'app-update-state': AppUpdateState
  'window-state-changed': WindowStateInfo
  'secure-credentials-lost': SecureCredentialsLossNotice
  /**
   * Full mpv snapshots for windows that called `mpv-subscribe`: lifecycle
   * changes at once, time and cache churn about five per second. `seq` orders them.
   */
  'mpv-state': MpvStateSnapshot
  'tls-untrusted-certificate': UntrustedCertificateNotice
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C]
