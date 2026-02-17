export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electron
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

export interface MpvTrackInfo {
  id: number
  type: 'audio' | 'sub'
  title?: string
  lang?: string
  codec?: string
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
  volume: number
  muted: boolean
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

export async function pickAndReadFile(
  filters?: { name: string; extensions: string[] }[]
): Promise<{ path: string; content: string } | null> {
  if (!isElectron() || !window.electron?.pickFileContent) return null
  return window.electron.pickFileContent(filters)
}

export async function probeEmbeddedSubtitles(streamUrl: string): Promise<EmbeddedSubtitleProbeTrack[]> {
  if (!isElectron() || !window.electron?.probeEmbeddedSubtitles) return []
  return window.electron.probeEmbeddedSubtitles(streamUrl)
}

export async function extractEmbeddedSubtitle(
  streamUrl: string,
  streamIndex: number
): Promise<EmbeddedSubtitleExtractionResult | null> {
  if (!isElectron() || !window.electron?.extractEmbeddedSubtitle) return null
  return window.electron.extractEmbeddedSubtitle(streamUrl, streamIndex)
}

export async function mpvIsAvailable(): Promise<boolean> {
  if (!isElectron() || !window.electron?.mpvIsAvailable) return false
  return window.electron.mpvIsAvailable()
}

export async function mpvOpen(streamUrl: string): Promise<void> {
  if (!isElectron() || !window.electron?.mpvOpen) return
  await window.electron.mpvOpen(streamUrl)
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

export async function mpvSetVolume(normalizedVolume: number): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetVolume) return
  await window.electron.mpvSetVolume(normalizedVolume)
}

export async function mpvSetMute(muted: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetMute) return
  await window.electron.mpvSetMute(muted)
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

export async function mpvSetFullscreen(fullscreen: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetFullscreen) return
  await window.electron.mpvSetFullscreen(fullscreen)
}

export async function mpvSetSubtitleStyle(style: MpvSubtitleStyle): Promise<void> {
  if (!isElectron() || !window.electron?.mpvSetSubtitleStyle) return
  await window.electron.mpvSetSubtitleStyle(style)
}

export async function mpvGetState(): Promise<MpvStateSnapshot | null> {
  if (!isElectron() || !window.electron?.mpvGetState) return null
  return window.electron.mpvGetState()
}

export function windowMinimize(): void {
  if (isElectron()) window.electron!.windowMinimize()
}

export function windowMaximize(): void {
  if (isElectron()) window.electron!.windowMaximize()
}

export function windowClose(): void {
  if (isElectron()) window.electron!.windowClose()
}

export async function windowSetFullscreen(fullscreen: boolean): Promise<void> {
  if (!isElectron() || !window.electron?.windowSetFullscreen) return
  await window.electron.windowSetFullscreen(fullscreen)
}

export async function windowIsFullscreen(): Promise<boolean> {
  if (!isElectron() || !window.electron?.windowIsFullscreen) return false
  return window.electron.windowIsFullscreen()
}
