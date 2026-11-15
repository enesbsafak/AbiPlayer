import type { BrowserWindow } from 'electron'
import type { MpvController } from '../mpv-controller'
import type { MpvStateSnapshot } from '../../shared/types/electron-ipc'
import { maskCredentials } from '../../shared/mask-credentials'
import type { IpcRegistrar } from './register'
import { isValidFilePathArgument, type PickedFileRegistry } from './files'
import {
  clampNormalizedVolume,
  isValidMpvSubtitleStyle,
  isValidMpvTrackId,
  isValidPlaybackTuning,
  isValidStreamUrl,
  requireBoolean,
  requireFiniteNumber
} from './validators'

export type MpvControllerApi = Pick<
  MpvController,
  | 'isAvailable'
  | 'open'
  | 'stopPlayback'
  | 'togglePause'
  | 'setPause'
  | 'seek'
  | 'seekTo'
  | 'jumpToLive'
  | 'setVolume'
  | 'setMute'
  | 'setAudioTrack'
  | 'setVideoTrack'
  | 'setSubtitleTrack'
  | 'addSubtitleFile'
  | 'setFullscreen'
  | 'setHardwareDecoding'
  | 'setAudioPassthrough'
  | 'setPlaybackTuning'
  | 'setSubtitleStyle'
  | 'setVideoMarginRatio'
  | 'getState'
>

export const SUBTITLE_NOT_PICKED_MESSAGE = 'Altyazı dosyası yalnızca dosya seçme penceresinden eklenebilir'

export function getNativeWindowId(window: BrowserWindow): string | null {
  const handle = window.getNativeWindowHandle()
  if (!handle || handle.length === 0) return null

  // Electron returns a pointer buffer; decode per platform.
  if (process.platform === 'win32') {
    // mpv expects the HWND as an unsigned 32-bit integer on win32.
    if (handle.length >= 4) return handle.readUInt32LE(0).toString()
    return null
  }

  // Linux X11 window id is 32-bit. macOS stores an NSView* pointer.
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
  if (handle.length >= 4) return handle.readUInt32LE(0).toString()
  return null
}

export function maskSnapshotError(state: MpvStateSnapshot): MpvStateSnapshot {
  if (!state.error) return state
  const masked = maskCredentials(state.error)
  return masked === state.error ? state : { ...state, error: masked }
}

export interface MpvHandlerDeps {
  controller: MpvControllerApi
  registry: Pick<PickedFileRegistry, 'wasPickedThisSession'>
  getWindow: (sender: Electron.WebContents) => BrowserWindow | null
}

export function registerMpvHandlers(registrar: IpcRegistrar, deps: MpvHandlerDeps): void {
  const { controller } = deps

  registrar.handle('mpv-is-available', () => controller.isAvailable())

  registrar.handle('mpv-open', async (event, streamUrl) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')
    const window = deps.getWindow(event.sender)
    const nativeWindowId = window ? getNativeWindowId(window) : null
    await controller.open(streamUrl, nativeWindowId ?? undefined)
  })

  registrar.handle('mpv-stop', () => controller.stopPlayback())
  registrar.handle('mpv-toggle-pause', () => controller.togglePause())

  registrar.handle('mpv-set-pause', (_event, paused) =>
    controller.setPause(requireBoolean(paused, 'Geçersiz duraklatma değeri'))
  )

  registrar.handle('mpv-seek', (_event, seconds) =>
    controller.seek(requireFiniteNumber(seconds, 'Geçersiz sarma değeri'))
  )

  registrar.handle('mpv-seek-to', async (_event, seconds) => {
    const target = requireFiniteNumber(seconds, 'Geçersiz hedef zaman')
    if (target < 0) throw new Error('Geçersiz hedef zaman')
    await controller.seekTo(target)
  })

  registrar.handle('mpv-jump-to-live', () => controller.jumpToLive())

  registrar.handle('mpv-set-volume', (_event, normalizedVolume) =>
    controller.setVolume(clampNormalizedVolume(normalizedVolume))
  )

  registrar.handle('mpv-set-mute', (_event, muted) =>
    controller.setMute(requireBoolean(muted, 'Geçersiz sessiz değeri'))
  )

  registrar.handle('mpv-set-audio-track', async (_event, trackId) => {
    if (!isValidMpvTrackId(trackId)) throw new Error('Geçersiz ses kanal kimliği')
    await controller.setAudioTrack(trackId)
  })

  registrar.handle('mpv-set-video-track', async (_event, trackId) => {
    if (!isValidMpvTrackId(trackId)) throw new Error('Geçersiz görüntü kalite kimliği')
    await controller.setVideoTrack(trackId)
  })

  registrar.handle('mpv-set-subtitle-track', async (_event, trackId) => {
    if (!isValidMpvTrackId(trackId)) throw new Error('Geçersiz altyazı kanal kimliği')
    await controller.setSubtitleTrack(trackId)
  })

  registrar.handle('mpv-add-subtitle-file', async (_event, filePath) => {
    if (!isValidFilePathArgument(filePath)) throw new Error('Geçersiz altyazı dosya yolu')
    if (!deps.registry.wasPickedThisSession(filePath)) throw new Error(SUBTITLE_NOT_PICKED_MESSAGE)
    return controller.addSubtitleFile(filePath)
  })

  registrar.handle('mpv-set-fullscreen', (_event, fullscreen) =>
    controller.setFullscreen(requireBoolean(fullscreen, 'Geçersiz tam ekran değeri'))
  )

  registrar.handle('mpv-set-hardware-decoding', (_event, enabled) =>
    controller.setHardwareDecoding(requireBoolean(enabled, 'Geçersiz donanım hızlandırma değeri'))
  )

  registrar.handle('mpv-set-audio-passthrough', (_event, enabled) =>
    controller.setAudioPassthrough(requireBoolean(enabled, 'Geçersiz ses passthrough değeri'))
  )

  registrar.handle('mpv-set-playback-tuning', async (_event, tuning) => {
    if (!isValidPlaybackTuning(tuning)) throw new Error('Geçersiz oynatma ayar verisi')
    await controller.setPlaybackTuning(tuning)
  })

  registrar.handle('mpv-set-subtitle-style', async (_event, style) => {
    if (!isValidMpvSubtitleStyle(style)) throw new Error('Geçersiz altyazı stil verisi')
    await controller.setSubtitleStyle(style)
  })

  registrar.handle('mpv-set-video-margin', async (event, right) => {
    const pixels = requireFiniteNumber(right, 'Geçersiz margin değeri')
    // mpv expresses this margin as a fraction of the window, so translate the
    // renderer's pixel width against the window that actually hosts the video.
    const windowWidth = deps.getWindow(event.sender)?.getContentBounds().width ?? 0
    const ratio = windowWidth > 0 ? Math.max(0, pixels) / windowWidth : 0
    await controller.setVideoMarginRatio(ratio)
  })

  // mpv pushes every property this snapshot exposes via `observe_property`,
  // so the cached state is already current; re-querying here would cost a
  // dozen round-trips per renderer poll.
  registrar.handle('mpv-get-state', () => maskSnapshotError(controller.getState()))
}
