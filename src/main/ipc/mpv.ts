import type { BrowserWindow } from 'electron'
import type { MpvController } from '../mpv-controller'
import type { MpvStateSnapshot } from '../../shared/types/electron-ipc'
import type { MpvOpenRequest } from '../../shared/ipc/contract'
import { credentialsInUrl, maskCredentials } from '../../shared/mask-credentials'
import { mpvHeaderOptions, sanitizeStreamHttpHeaders } from '../../shared/playback/http-headers'
import { sendEvent, type EventTarget } from './events'
import type { IpcRegistrar } from './register'
import { isValidFilePathArgument, type PickedFileRegistry } from './files'
import { isValidVideoRect, videoMarginRatiosForRect } from '../mpv/video-rect'
import { subtitleInsetRatio } from '../mpv/subtitle-position'
import {
  clampNormalizedVolume,
  isValidMpvSubtitleStyle,
  isValidMpvTrackId,
  isValidPlaybackTuning,
  isValidStreamUrl,
  requireBoolean,
  requireFiniteNumber
} from './validators'
import { mainStrings } from '../../shared/main-strings'

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
  | 'setSubtitleInsetRatio'
  | 'setVideoRect'
  | 'getState'
  | 'subscribe'
>

export const SUBTITLE_NOT_PICKED_MESSAGE = mainStrings.files.subtitleNotPicked

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

/**
 * `knownSecrets`: the account in the URL this playback loaded, masked
 * wherever mpv's error repeats it (a redirect target, a segment URL).
 */
export function maskSnapshotError(state: MpvStateSnapshot, knownSecrets: readonly string[] = []): MpvStateSnapshot {
  if (!state.error) return state
  const masked = maskCredentials(state.error, knownSecrets)
  return masked === state.error ? state : { ...state, error: masked }
}

/**
 * The credentials in the URL each recent playback opened, by `playbackId`.
 * A snapshot names the playback its error belongs to; a few recent ones are
 * kept because a superseded playback's last snapshot can still be in flight.
 */
export class PlaybackSecrets {
  private readonly byPlayback = new Map<string, string[]>()

  constructor(private readonly limit = 8) {}

  remember(playbackId: string, url: string): void {
    this.byPlayback.delete(playbackId)
    this.byPlayback.set(playbackId, credentialsInUrl(url))
    for (const oldest of this.byPlayback.keys()) {
      if (this.byPlayback.size <= this.limit) break
      this.byPlayback.delete(oldest)
    }
  }

  of(state: Pick<MpvStateSnapshot, 'playbackId'>): readonly string[] {
    return (state.playbackId && this.byPlayback.get(state.playbackId)) || []
  }
}

const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function parseMpvOpenRequest(value: unknown): MpvOpenRequest {
  if (!value || typeof value !== 'object') throw new Error(mainStrings.invalid.playbackRequest)
  const { playbackId, tuning, httpHeaders: rawHeaders } = value as Partial<MpvOpenRequest>
  if (typeof playbackId !== 'string' || !PLAYBACK_ID_PATTERN.test(playbackId)) {
    throw new Error(mainStrings.invalid.playbackId)
  }
  if (tuning !== undefined && !isValidPlaybackTuning(tuning)) {
    throw new Error(mainStrings.invalid.playbackTuning)
  }
  // Read from a playlist file: only what passes the check is kept.
  const httpHeaders = sanitizeStreamHttpHeaders(rawHeaders)
  return {
    playbackId,
    ...(tuning === undefined ? {} : { tuning }),
    ...(httpHeaders ? { httpHeaders } : {})
  }
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

  constructor(
    private readonly controller: Pick<MpvControllerApi, 'subscribe' | 'getState'>,
    private readonly secrets: Pick<PlaybackSecrets, 'of'> = { of: () => [] }
  ) {}

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
        sendEvent(target, 'mpv-state', maskSnapshotError(snapshot, this.secrets.of(snapshot)))
      })
    }
    const state = this.controller.getState()
    return maskSnapshotError(state, this.secrets.of(state))
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
  const secrets = new PlaybackSecrets()
  const subscriptions = new MpvStateSubscriptions(controller, secrets)
  // TLS checks may wait on the network; a newer open or a stop meanwhile wins.
  let tlsOpenSeq = 0
  // The request headers of the playback mpv has open, as per-file options.
  let playbackHeaders: { playbackId: string; options: Record<string, string> } | null = null
  const headerOptionsOf = (playbackId: string | null): Record<string, string> =>
    playbackHeaders !== null && playbackHeaders.playbackId === playbackId ? playbackHeaders.options : {}

  registrar.handle('mpv-is-available', () => controller.isAvailable())

  registrar.handle('mpv-open', async (event, streamUrl, request) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error(mainStrings.invalid.streamUrl)
    const { playbackId, tuning, httpHeaders } = parseMpvOpenRequest(request)
    secrets.remember(playbackId, streamUrl)
    // Headers belong to the playback: a reconnect (the same id, sent without
    // them) keeps them, another playback starts without any.
    if (httpHeaders) playbackHeaders = { playbackId, options: mpvHeaderOptions(httpHeaders) }
    else if (playbackHeaders?.playbackId !== playbackId) playbackHeaders = null
    const headerOptions = headerOptionsOf(playbackId)
    // TLS (src/main/tls): options for this load only; rejects if the host is refused.
    const tlsSeq = ++tlsOpenSeq
    const fileOptions = { ...(deps.tls ? await deps.tls.mpvLoadOptions(streamUrl) : {}), ...headerOptions }
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
    controller.setPause(requireBoolean(paused, mainStrings.invalid.pause))
  )

  registrar.handle('mpv-seek', (_event, seconds) =>
    controller.seek(requireFiniteNumber(seconds, mainStrings.invalid.seek))
  )

  registrar.handle('mpv-seek-to', async (_event, seconds) => {
    const target = requireFiniteNumber(seconds, mainStrings.invalid.seekTarget)
    if (target < 0) throw new Error(mainStrings.invalid.seekTarget)
    await controller.seekTo(target)
  })

  // A new load of the same URL: its TLS options are decided again, never
  // reused from the load it replaces (a revoked trust, a changed certificate).
  registrar.handle('mpv-jump-to-live', () => {
    const tls = deps.tls
    // Asked only when a playback named headers: most never do.
    const headerOptions = playbackHeaders ? headerOptionsOf(controller.getState().playbackId) : {}
    if (Object.keys(headerOptions).length === 0) return controller.jumpToLive(tls ? (url) => tls.mpvLoadOptions(url) : undefined)
    return controller.jumpToLive(async (url) => ({ ...(tls ? await tls.mpvLoadOptions(url) : {}), ...headerOptions }))
  })

  registrar.handle('mpv-set-volume', (_event, normalizedVolume) =>
    controller.setVolume(clampNormalizedVolume(normalizedVolume))
  )

  registrar.handle('mpv-set-mute', (_event, muted) =>
    controller.setMute(requireBoolean(muted, mainStrings.invalid.mute))
  )

  registrar.handle('mpv-set-audio-track', async (_event, trackId) => {
    if (!isValidMpvTrackId(trackId)) throw new Error(mainStrings.invalid.audioTrack)
    await controller.setAudioTrack(trackId)
  })

  registrar.handle('mpv-set-video-track', async (_event, trackId) => {
    if (!isValidMpvTrackId(trackId)) throw new Error(mainStrings.invalid.videoTrack)
    await controller.setVideoTrack(trackId)
  })

  registrar.handle('mpv-set-subtitle-track', async (_event, trackId) => {
    if (!isValidMpvTrackId(trackId)) throw new Error(mainStrings.invalid.subtitleTrack)
    await controller.setSubtitleTrack(trackId)
  })

  registrar.handle('mpv-add-subtitle-file', async (_event, filePath) => {
    if (!isValidFilePathArgument(filePath)) throw new Error(mainStrings.invalid.subtitlePath)
    if (!deps.registry.wasPickedThisSession(filePath)) throw new Error(SUBTITLE_NOT_PICKED_MESSAGE)
    return controller.addSubtitleFile(filePath)
  })

  registrar.handle('mpv-set-fullscreen', (_event, fullscreen) =>
    controller.setFullscreen(requireBoolean(fullscreen, mainStrings.invalid.fullscreen))
  )

  registrar.handle('mpv-set-hardware-decoding', (_event, enabled) =>
    controller.setHardwareDecoding(requireBoolean(enabled, mainStrings.invalid.hardwareDecoding))
  )

  registrar.handle('mpv-set-audio-passthrough', (_event, enabled) =>
    controller.setAudioPassthrough(requireBoolean(enabled, mainStrings.invalid.passthrough))
  )

  registrar.handle('mpv-set-playback-tuning', async (_event, tuning) => {
    if (!isValidPlaybackTuning(tuning)) throw new Error(mainStrings.invalid.playbackTuning)
    await controller.setPlaybackTuning(tuning)
  })

  registrar.handle('mpv-set-subtitle-style', async (_event, style) => {
    if (!isValidMpvSubtitleStyle(style)) throw new Error(mainStrings.invalid.subtitleStyle)
    await controller.setSubtitleStyle(style)
  })

  registrar.handle('mpv-set-video-margin', async (event, right) => {
    const pixels = requireFiniteNumber(right, mainStrings.invalid.margin)
    // mpv expresses this margin as a fraction of the window, so translate the
    // renderer's pixel width against the window that actually hosts the video.
    const windowWidth = deps.getWindow(event.sender)?.getContentBounds().width ?? 0
    const ratio = windowWidth > 0 ? Math.max(0, pixels) / windowWidth : 0
    await controller.setVideoMarginRatio(ratio)
  })

  // Subtitles clear the player's controls: the renderer gives their height
  // above the window's bottom edge in CSS pixels (0 while they are hidden),
  // mpv wants a share of the window that hosts the video.
  registrar.handle('mpv-set-subtitle-inset', async (event, bottom) => {
    const pixels = requireFiniteNumber(bottom, mainStrings.invalid.subtitleInset)
    const windowHeight = deps.getWindow(event.sender)?.getContentBounds().height ?? 0
    await controller.setSubtitleInsetRatio(subtitleInsetRatio(pixels, windowHeight))
  })

  // The experimental corner player: the picture goes into a rectangle of the
  // window, given in CSS pixels and turned into mpv's ratios against the
  // window that hosts the video.
  registrar.handle('mpv-set-video-rect', async (event, rect) => {
    if (rect === null) {
      await controller.setVideoRect(null)
      return
    }
    if (!isValidVideoRect(rect)) throw new Error(mainStrings.invalid.videoRect)
    const bounds = deps.getWindow(event.sender)?.getContentBounds()
    const margins = bounds ? videoMarginRatiosForRect(rect, bounds) : null
    await controller.setVideoRect(margins)
  })

  // mpv pushes every property this snapshot exposes via `observe_property`,
  // so the cached state is already current.
  registrar.handle('mpv-get-state', () => {
    const state = controller.getState()
    return maskSnapshotError(state, secrets.of(state))
  })

  registrar.handle('mpv-subscribe', (event) => subscriptions.subscribe(event.sender))
  registrar.handle('mpv-unsubscribe', (event) => subscriptions.unsubscribe(event.sender))
}
