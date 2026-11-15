import type { BrowserWindow } from 'electron'
import type { MpvController } from '../mpv-controller'
import type { MpvStateSnapshot } from '../../shared/types/electron-ipc'
import type { MpvOpenRequest } from '../../shared/ipc/contract'
import { maskCredentials } from '../../shared/mask-credentials'
import { sendEvent, type EventTarget } from './events'
import type { IpcRegistrar } from './register'
import { isValidFilePathArgument, type PickedFileRegistry } from './files'
import { isValidVideoRect, videoMarginRatiosForRect } from '../mpv/video-rect'
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
  | 'setVideoRect'
  | 'getState'
  | 'subscribe'
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

const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function parseMpvOpenRequest(value: unknown): MpvOpenRequest {
  if (!value || typeof value !== 'object') throw new Error('Geçersiz oynatma isteği')
  const { playbackId, tuning } = value as Partial<MpvOpenRequest>
  if (typeof playbackId !== 'string' || !PLAYBACK_ID_PATTERN.test(playbackId)) {
    throw new Error('Geçersiz oynatma kimliği')
  }
  if (tuning !== undefined && !isValidPlaybackTuning(tuning)) {
    throw new Error('Geçersiz oynatma ayar verisi')
  }
  return tuning === undefined ? { playbackId } : { playbackId, tuning }
}

/** A window that receives `mpv-state` pushes. */
export interface MpvStateSubscriber extends EventTarget {
  id: number
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

/**
 * One controller subscription per window. Subscribing again (a renderer reload
 * of the same window, a second hook) keeps the one there is; the window going
 * away ends it.
 */
export class MpvStateSubscriptions {
  private readonly active = new Map<number, { unsubscribe: () => void; onDestroyed: () => void }>()

  constructor(private readonly controller: Pick<MpvControllerApi, 'subscribe' | 'getState'>) {}

  /** Returns the current snapshot. */
  subscribe(target: MpvStateSubscriber): MpvStateSnapshot {
    if (!this.active.has(target.id)) {
      const onDestroyed = (): void => this.unsubscribe(target)
      target.once('destroyed', onDestroyed)
      // The controller replays the current snapshot synchronously; registering
      // first keeps a destroyed window from being subscribed forever.
      const entry: { unsubscribe: () => void; onDestroyed: () => void } = {
        unsubscribe: () => undefined,
        onDestroyed
      }
      this.active.set(target.id, entry)
      entry.unsubscribe = this.controller.subscribe((snapshot) => {
        sendEvent(target, 'mpv-state', maskSnapshotError(snapshot))
      })
    }
    return maskSnapshotError(this.controller.getState())
  }

  unsubscribe(target: MpvStateSubscriber): void {
    const entry = this.active.get(target.id)
    if (!entry) return
    this.active.delete(target.id)
    target.removeListener('destroyed', entry.onDestroyed)
    entry.unsubscribe()
  }

  get size(): number {
    return this.active.size
  }
}

/**
 * How long after the window is shown and its page has loaded the idle mpv is
 * started. The page renders and hydrates in that time without a process
 * launch (and its GPU init) competing for the machine.
 */
export const MPV_PREWARM_DELAY_MS = 1500

export interface MpvPrewarmDeps {
  controller: Pick<MpvControllerApi, 'isAvailable'> & Pick<MpvController, 'prewarm'>
  /** The host window's handle, or null while it has none (or is gone). */
  getWindowId: () => string | null
  delayMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
}

/**
 * Pre-warms mpv once the window has been shown and its page has finished
 * loading — in either order, and again after each reload — so the first play
 * only has to send `loadfile`. Skipped quietly without an mpv binary or a
 * window handle; the first `open` then starts mpv as before.
 */
export function createMpvPrewarmTrigger(deps: MpvPrewarmDeps): {
  windowShown(): void
  pageLoaded(): void
} {
  const delayMs = deps.delayMs ?? MPV_PREWARM_DELAY_MS
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  let shown = false
  let loaded = false

  const run = async (): Promise<void> => {
    if (!(await deps.controller.isAvailable().catch(() => false))) return
    const windowId = deps.getWindowId()
    if (!windowId) return
    await deps.controller.prewarm(windowId)
  }

  const maybeSchedule = (): void => {
    if (!shown || !loaded) return
    loaded = false
    setTimer(() => void run().catch(() => undefined), delayMs)
  }

  return {
    windowShown() {
      shown = true
      maybeSchedule()
    },
    pageLoaded() {
      loaded = true
      maybeSchedule()
    }
  }
}

export interface MpvHandlerDeps {
  controller: MpvControllerApi
  registry: Pick<PickedFileRegistry, 'wasPickedThisSession'>
  getWindow: (sender: Electron.WebContents) => BrowserWindow | null
  /** TLS policy (src/main/tls): per-load verification options, or a refusal. */
  tls?: { mpvLoadOptions(url: string): Promise<Record<string, string>> }
}

export function registerMpvHandlers(registrar: IpcRegistrar, deps: MpvHandlerDeps): void {
  const { controller } = deps
  const subscriptions = new MpvStateSubscriptions(controller)
  // TLS checks may wait on the network; a newer open or a stop meanwhile wins.
  let tlsOpenSeq = 0

  registrar.handle('mpv-is-available', () => controller.isAvailable())

  registrar.handle('mpv-open', async (event, streamUrl, request) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')
    const { playbackId, tuning } = parseMpvOpenRequest(request)
    // TLS (src/main/tls): options for this load only; rejects if the host is refused.
    const tlsSeq = ++tlsOpenSeq
    const fileOptions = deps.tls ? await deps.tls.mpvLoadOptions(streamUrl) : {}
    if (tlsSeq !== tlsOpenSeq) return
    const window = deps.getWindow(event.sender)
    const nativeWindowId = window ? getNativeWindowId(window) : null
    await controller.open(
      streamUrl,
      nativeWindowId ?? undefined,
      tuning ? { playbackId, tuning, fileOptions } : { playbackId, fileOptions }
    )
  })

  registrar.handle('mpv-stop', () => {
    tlsOpenSeq += 1 // TLS: a stop supersedes an open still being checked
    return controller.stopPlayback()
  })
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

  // A new load of the same URL: its TLS options are decided again, never
  // reused from the load it replaces (a revoked trust, a changed certificate).
  registrar.handle('mpv-jump-to-live', () => {
    const tls = deps.tls
    return controller.jumpToLive(tls ? (url) => tls.mpvLoadOptions(url) : undefined)
  })

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

  // The experimental corner player: the picture goes into a rectangle of the
  // window, given in CSS pixels and turned into mpv's ratios against the
  // window that hosts the video.
  registrar.handle('mpv-set-video-rect', async (event, rect) => {
    if (rect === null) {
      await controller.setVideoRect(null)
      return
    }
    if (!isValidVideoRect(rect)) throw new Error('Geçersiz görüntü alanı')
    const bounds = deps.getWindow(event.sender)?.getContentBounds()
    const margins = bounds ? videoMarginRatiosForRect(rect, bounds) : null
    await controller.setVideoRect(margins)
  })

  // mpv pushes every property this snapshot exposes via `observe_property`,
  // so the cached state is already current.
  registrar.handle('mpv-get-state', () => maskSnapshotError(controller.getState()))

  registrar.handle('mpv-subscribe', (event) => subscriptions.subscribe(event.sender))
  registrar.handle('mpv-unsubscribe', (event) => subscriptions.unsubscribe(event.sender))
}
