import type {
  AppUpdateState,
  EmbeddedSubtitleExtractionResult,
  EmbeddedSubtitleProbeTrack,
  MpvPlaybackTuning,
  MpvStateSnapshot,
  MpvSubtitleStyle,
  MpvTrackInfo
} from '../../../shared/types/electron-ipc'
import {
  MEDIA_JOB_CANCELLED_MESSAGE,
  type CertificateTrustRequest,
  type TrustedCertificateHost,
  type UntrustedCertificateNotice,
  type FileFilter,
  type LegalNoticeTarget,
  type MediaJobOptions,
  type MpvOpenRequest,
  type MpvVideoRect,
  type PickedFile,
  type WindowStateInfo
} from '../../../shared/ipc/contract'
import { strings } from '@/strings'

export type {
  AppUpdateState,
  EmbeddedSubtitleExtractionResult,
  EmbeddedSubtitleProbeTrack,
  FileFilter,
  MediaJobOptions,
  MpvOpenRequest,
  MpvVideoRect,
  MpvPlaybackTuning,
  MpvStateSnapshot,
  MpvSubtitleStyle,
  MpvTrackInfo,
  PickedFile,
  WindowStateInfo
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electron
}

export async function pickAndReadFile(filters?: FileFilter[]): Promise<PickedFile | null> {
  if (!isElectron() || !window.electron?.pickFileContent) return null
  return window.electron.pickFileContent(filters)
}

/**
 * Re-reads a file the user picked through `pickAndReadFile` earlier, also in a
 * previous run. Main refuses any other path. Rejects when the file is gone,
 * too large or not allowed; returns null outside Electron.
 */
export async function readPickedFile(filePath: string): Promise<PickedFile | null> {
  if (!isElectron() || !window.electron?.readPickedFile) return null
  return window.electron.readPickedFile(filePath)
}

/**
 * The key that seals cached M3U data, raw bytes, held in memory only (main
 * keeps it in the OS-protected credential file). Null outside Electron;
 * rejects when secure storage is unavailable.
 */
export async function getCatalogCacheKey(): Promise<ArrayBuffer | null> {
  if (!isElectron() || !window.electron?.getCatalogCacheKey) return null
  const base64 = await window.electron.getCatalogCacheKey()
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Starting a probe or an extraction cancels the previous one this window
 * started; the cancelled call rejects with an error that
 * `isMediaJobCancelledError` recognises.
 */
export async function probeEmbeddedSubtitles(
  streamUrl: string,
  options?: MediaJobOptions
): Promise<EmbeddedSubtitleProbeTrack[]> {
  if (!isElectron() || !window.electron?.probeEmbeddedSubtitles) return []
  return window.electron.probeEmbeddedSubtitles(streamUrl, options)
}

export async function extractEmbeddedSubtitle(
  streamUrl: string,
  streamIndex: number,
  options?: MediaJobOptions
): Promise<EmbeddedSubtitleExtractionResult | null> {
  if (!isElectron() || !window.electron?.extractEmbeddedSubtitle) return null
  return window.electron.extractEmbeddedSubtitle(streamUrl, streamIndex, options)
}

/** Cancels one probe/extraction by the `jobId` given in its options. Resolves true if it was running. */
export async function cancelMediaJob(jobId: string): Promise<boolean> {
  if (!isElectron() || !window.electron?.cancelMediaJob) return false
  return window.electron.cancelMediaJob(jobId)
}

/** Cancels every probe/extraction this window started. */
export async function cancelAllMediaJobs(): Promise<boolean> {
  if (!isElectron() || !window.electron?.cancelMediaJob) return false
  return window.electron.cancelMediaJob()
}

export function isMediaJobCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MEDIA_JOB_CANCELLED_MESSAGE)
}

export async function mpvIsAvailable(): Promise<boolean> {
  if (!isElectron() || !window.electron?.mpvIsAvailable) return false
  return window.electron.mpvIsAvailable()
}

/**
 * Opens `streamUrl` as the playback `request.playbackId`; every snapshot about
 * it carries that id back. Opening the same id again is a reconnect.
 */
export async function mpvOpen(streamUrl: string, request: MpvOpenRequest): Promise<void> {
  if (!isElectron() || !window.electron?.mpvOpen) return
  await window.electron.mpvOpen(streamUrl, request)
}

export async function mpvStop(): Promise<void> {
  if (!isElectron() || !window.electron?.mpvStop) return
  await window.electron.mpvStop()
}

export async function mpvTogglePause(): Promise<void> {
  if (!isElectron() || !window.electron?.mpvTogglePause) return
  await window.electron.mpvTogglePause()
}

export async function mpvSetPause(paused: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetPause) return
  await window.electron.mpvSetPause(paused)
}

export async function mpvSeek(seconds: number): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSeek) return
  await window.electron.mpvSeek(seconds)
}

export async function mpvSeekTo(seconds: number): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSeekTo) return
  await window.electron.mpvSeekTo(seconds)
}

export async function mpvJumpToLive(): Promise<void> {
  if (!isElectron() || !window.electron?.mpvJumpToLive) return
  await window.electron.mpvJumpToLive()
}

export async function mpvSetVolume(normalizedVolume: number): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetVolume) return
  await window.electron.mpvSetVolume(normalizedVolume)
}

export async function mpvSetMute(muted: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetMute) return
  await window.electron.mpvSetMute(muted)
}

export async function mpvSetVideoTrack(trackId: number | null): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetVideoTrack) return
  await window.electron.mpvSetVideoTrack(trackId)
}

export async function mpvSetAudioTrack(trackId: number | null): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetAudioTrack) return
  await window.electron.mpvSetAudioTrack(trackId)
}

export async function mpvSetSubtitleTrack(trackId: number | null): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetSubtitleTrack) return
  await window.electron.mpvSetSubtitleTrack(trackId)
}

export async function mpvAddSubtitleFile(filePath: string): Promise<number | null> {
  if (!isElectron() || !window.electron?.mpvAddSubtitleFile) return null
  return window.electron.mpvAddSubtitleFile(filePath)
}

export async function mpvSetVideoMargin(right: number): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetVideoMargin) return
  await window.electron.mpvSetVideoMargin(right)
}

/** Lifts mpv's subtitles `bottom` CSS pixels above their usual place; 0 puts them back. */
export async function mpvSetSubtitleInset(bottom: number): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetSubtitleInset) return
  await window.electron.mpvSetSubtitleInset(bottom)
}

export async function mpvSetVideoRect(rect: MpvVideoRect | null): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetVideoRect) return
  await window.electron.mpvSetVideoRect(rect)
}

export async function mpvSetFullscreen(fullscreen: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetFullscreen) return
  await window.electron.mpvSetFullscreen(fullscreen)
}

export async function mpvSetHardwareDecoding(enabled: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetHardwareDecoding) return
  await window.electron.mpvSetHardwareDecoding(enabled)
}

export async function mpvSetAudioPassthrough(enabled: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetAudioPassthrough) return
  await window.electron.mpvSetAudioPassthrough(enabled)
}

export async function mpvSetSubtitleStyle(style: MpvSubtitleStyle): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetSubtitleStyle) return
  await window.electron.mpvSetSubtitleStyle(style)
}

export async function mpvSetPlaybackTuning(tuning: MpvPlaybackTuning): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetPlaybackTuning) return
  await window.electron.mpvSetPlaybackTuning(tuning)
}

export async function mpvGetState(): Promise<MpvStateSnapshot | null> {
  if (!isElectron() || !window.electron?.mpvGetState) return null
  return window.electron.mpvGetState()
}

const mpvStateListeners = new Set<(snapshot: MpvStateSnapshot) => void>()
let stopMpvStateEvents: (() => void) | null = null

function deliverMpvState(snapshot: MpvStateSnapshot): void {
  for (const listener of Array.from(mpvStateListeners)) listener(snapshot)
}

/**
 * Listens to mpv's snapshots. The listener first gets the current snapshot
 * (asynchronously), then every change main pushes. Deliveries can repeat or,
 * around the first one, arrive out of order: order them by `seq`. One IPC
 * subscription serves every listener in this window; it ends with the last.
 * Returns the unsubscribe function, or null outside Electron.
 */
export function subscribeMpvState(listener: (snapshot: MpvStateSnapshot) => void): (() => void) | null {
  const api = isElectron() ? window.electron : undefined
  if (!api?.onMpvState || !api.mpvSubscribe) return null

  const first = mpvStateListeners.size === 0
  mpvStateListeners.add(listener)
  if (first) stopMpvStateEvents = api.onMpvState(deliverMpvState)
  api.mpvSubscribe().then(
    (snapshot) => {
      if (mpvStateListeners.has(listener)) listener(snapshot)
    },
    () => undefined
  )

  return () => {
    if (!mpvStateListeners.delete(listener) || mpvStateListeners.size > 0) return
    stopMpvStateEvents?.()
    stopMpvStateEvents = null
    void api.mpvUnsubscribe?.().catch(() => undefined)
  }
}

export async function setPreventDisplaySleep(prevented: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.setPreventDisplaySleep) return
  await window.electron.setPreventDisplaySleep(prevented)
}

// Title-bar buttons: nothing to show the viewer if main refuses (the window is
// already going away), but say so in the console.
function windowCommand(name: string, run: () => Promise<void>): void {
  void run().catch((error: unknown) => console.warn(`[window] ${name} failed:`, error))
}

export function windowMinimize(): void {
  if (isElectron()) windowCommand('minimize', () => window.electron!.windowMinimize())
}

export function windowMaximize(): void {
  if (isElectron()) windowCommand('maximize', () => window.electron!.windowMaximize())
}

export function windowClose(): void {
  if (isElectron()) windowCommand('close', () => window.electron!.windowClose())
}

export async function windowSetFullscreen(fullscreen: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.windowSetFullscreen) return
  await window.electron.windowSetFullscreen(fullscreen)
}

export async function windowIsFullscreen(): Promise<boolean> {
  if (!isElectron() || !window.electron?.windowIsFullscreen) return false
  return window.electron.windowIsFullscreen()
}

export async function windowGetState(): Promise<WindowStateInfo | null> {
  if (!isElectron() || !window.electron?.windowGetState) return null
  return window.electron.windowGetState()
}

/** Fires on maximize, unmaximize and fullscreen changes. Returns an unsubscribe function, or null outside Electron. */
export function onWindowStateChange(listener: (state: WindowStateInfo) => void): (() => void) | null {
  if (!isElectron() || !window.electron?.onWindowStateChange) return null
  return window.electron.onWindowStateChange(listener)
}

export async function getAppUpdateState(): Promise<AppUpdateState | null> {
  if (!isElectron() || !window.electron?.getAppUpdateState) return null
  return window.electron.getAppUpdateState()
}

export async function checkForAppUpdates(): Promise<AppUpdateState | null> {
  if (!isElectron() || !window.electron?.checkForAppUpdates) return null
  return window.electron.checkForAppUpdates()
}

export async function installAppUpdate(): Promise<boolean> {
  if (!isElectron() || !window.electron?.installAppUpdate) return false
  return window.electron.installAppUpdate()
}

export function onAppUpdateStateChange(listener: (state: AppUpdateState) => void): (() => void) | null {
  if (!isElectron() || !window.electron?.onAppUpdateStateChange) return null
  return window.electron.onAppUpdateStateChange(listener)
}

export type { LegalNoticeTarget } from '../../../shared/ipc/contract'

/**
 * Opens the third-party notices file or the licence folder shipped with the
 * app. False when it is missing, did not open, or outside Electron.
 */
export async function openLegalNotice(target: LegalNoticeTarget): Promise<boolean> {
  if (!isElectron() || !window.electron?.openLegalNotice) return false
  return window.electron.openLegalNotice(target)
}

export type {
  CertificateProblem,
  CertificateTrustRequest,
  TrustedCertificateHost,
  UntrustedCertificateNotice
} from '../../../shared/ipc/contract'

/** Hosts the user trusted, each pinned to one certificate. Empty outside Electron. */
export async function tlsListTrusted(): Promise<TrustedCertificateHost[]> {
  if (!isElectron() || !window.electron?.tlsListTrusted) return []
  return window.electron.tlsListTrusted()
}

/** Certificates main refused in this run and nobody has trusted since, newest first. */
export async function tlsListUntrusted(): Promise<UntrustedCertificateNotice[]> {
  if (!isElectron() || !window.electron?.tlsListUntrusted) return []
  return window.electron.tlsListUntrusted()
}

/** Pins the certificate main last saw for that host and port. Rejects for GitHub/TMDB hosts. */
export async function tlsTrust(request: CertificateTrustRequest): Promise<TrustedCertificateHost> {
  if (!isElectron() || !window.electron?.tlsTrust) throw new Error(strings.security.trust.appOnly)
  return window.electron.tlsTrust(request)
}

export async function tlsRevoke(host: string, port: number): Promise<boolean> {
  if (!isElectron() || !window.electron?.tlsRevoke) return false
  return window.electron.tlsRevoke(host, port)
}

/** Fires when a server presents a certificate the app refused. Returns an unsubscribe function, or null outside Electron. */
export function onUntrustedCertificate(listener: (notice: UntrustedCertificateNotice) => void): (() => void) | null {
  if (!isElectron() || !window.electron?.onUntrustedCertificate) return null
  return window.electron.onUntrustedCertificate(listener)
}
