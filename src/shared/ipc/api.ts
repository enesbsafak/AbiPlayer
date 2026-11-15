import type {
  IpcArgs,
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeChannel,
  IpcResult
} from './contract'

/**
 * `window.electron` method name → invoke channel. Preload builds the bridge by
 * walking this table, and `ElectronApi` is computed from it, so the exposed
 * object and its type cannot drift apart.
 */
export const INVOKE_METHODS = {
  pickFileContent: 'pick-file-content',
  readPickedFile: 'read-picked-file',

  getSecureCredentials: 'secure-credentials-get-all',
  setSecureCredential: 'secure-credentials-set',
  deleteSecureCredential: 'secure-credentials-delete',
  getSecureCredentialsLoss: 'secure-credentials-get-loss',

  probeEmbeddedSubtitles: 'embedded-subtitles-probe',
  extractEmbeddedSubtitle: 'embedded-subtitles-extract',
  cancelMediaJob: 'media-job-cancel',

  mpvIsAvailable: 'mpv-is-available',
  mpvOpen: 'mpv-open',
  mpvStop: 'mpv-stop',
  mpvTogglePause: 'mpv-toggle-pause',
  mpvSetPause: 'mpv-set-pause',
  mpvSeek: 'mpv-seek',
  mpvSeekTo: 'mpv-seek-to',
  mpvJumpToLive: 'mpv-jump-to-live',
  mpvSetVolume: 'mpv-set-volume',
  mpvSetMute: 'mpv-set-mute',
  mpvSetVideoTrack: 'mpv-set-video-track',
  mpvSetAudioTrack: 'mpv-set-audio-track',
  mpvSetSubtitleTrack: 'mpv-set-subtitle-track',
  mpvAddSubtitleFile: 'mpv-add-subtitle-file',
  mpvSetFullscreen: 'mpv-set-fullscreen',
  mpvSetHardwareDecoding: 'mpv-set-hardware-decoding',
  mpvSetAudioPassthrough: 'mpv-set-audio-passthrough',
  mpvSetSubtitleStyle: 'mpv-set-subtitle-style',
  mpvSetPlaybackTuning: 'mpv-set-playback-tuning',
  mpvSetVideoMargin: 'mpv-set-video-margin',
  mpvGetState: 'mpv-get-state',
  mpvSubscribe: 'mpv-subscribe',
  mpvUnsubscribe: 'mpv-unsubscribe',

  setPreventDisplaySleep: 'display-sleep-set-prevented',

  windowMinimize: 'window-minimize',
  windowMaximize: 'window-maximize',
  windowClose: 'window-close',
  windowSetFullscreen: 'window-set-fullscreen',
  windowIsFullscreen: 'window-is-fullscreen',
  windowGetState: 'window-get-state',

  getAppUpdateState: 'app-update-get-state',
  checkForAppUpdates: 'app-update-check',
  installAppUpdate: 'app-update-install',
  getStoreBackup: 'store-backup-read',
  deleteStoreBackup: 'store-backup-delete',

  tlsListTrusted: 'tls-list-trusted',
  tlsListUntrusted: 'tls-list-untrusted',
  tlsTrust: 'tls-trust',
  tlsRevoke: 'tls-revoke'
} as const satisfies Record<string, IpcInvokeChannel>

/** `window.electron` subscribe function → event channel. Each returns an unsubscribe function. */
export const EVENT_METHODS = {
  onAppUpdateStateChange: 'app-update-state',
  onWindowStateChange: 'window-state-changed',
  onSecureCredentialsLost: 'secure-credentials-lost',
  onMpvState: 'mpv-state',
  onUntrustedCertificate: 'tls-untrusted-certificate'
} as const satisfies Record<string, IpcEventChannel>

type InvokeMethods = typeof INVOKE_METHODS
type EventMethods = typeof EVENT_METHODS

export type ElectronInvokeApi = {
  [K in keyof InvokeMethods]: (
    ...args: IpcArgs<InvokeMethods[K]>
  ) => Promise<IpcResult<InvokeMethods[K]>>
}

export type ElectronEventApi = {
  [K in keyof EventMethods]: (
    listener: (payload: IpcEventPayload<EventMethods[K]>) => void
  ) => () => void
}

export type ElectronApi = ElectronInvokeApi & ElectronEventApi
