import { contextBridge, ipcRenderer } from 'electron'

type FileFilter = { name: string; extensions: string[] }
type PickedFile = { path: string; content: string }
type SecureXtreamCredentials = { url: string; username: string; password: string }
type EmbeddedSubtitleProbeTrack = {
  index: number
  codec: string
  language?: string
  title?: string
}
type EmbeddedSubtitleExtractionResult = {
  format: 'vtt'
  content: string
}
type MpvTrackInfo = {
  id: number
  type: 'audio' | 'sub'
  title?: string
  lang?: string
  codec?: string
  selected: boolean
  external: boolean
}
type MpvStateSnapshot = {
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
type MpvSubtitleStyle = {
  fontSize: number
  color: string
  background: string
}

const api = {
  pickFileContent: (filters?: FileFilter[]) =>
    ipcRenderer.invoke('pick-file-content', filters) as Promise<PickedFile | null>,
  getSecureCredentials: () =>
    ipcRenderer.invoke('secure-credentials-get-all') as Promise<Record<string, SecureXtreamCredentials>>,
  setSecureCredential: (sourceId: string, credential: SecureXtreamCredentials) =>
    ipcRenderer.invoke('secure-credentials-set', sourceId, credential) as Promise<void>,
  deleteSecureCredential: (sourceId: string) =>
    ipcRenderer.invoke('secure-credentials-delete', sourceId) as Promise<void>,
  probeEmbeddedSubtitles: (streamUrl: string) =>
    ipcRenderer.invoke('embedded-subtitles-probe', streamUrl) as Promise<EmbeddedSubtitleProbeTrack[]>,
  extractEmbeddedSubtitle: (streamUrl: string, streamIndex: number) =>
    ipcRenderer.invoke('embedded-subtitles-extract', streamUrl, streamIndex) as Promise<EmbeddedSubtitleExtractionResult | null>,
  mpvIsAvailable: () => ipcRenderer.invoke('mpv-is-available') as Promise<boolean>,
  mpvOpen: (streamUrl: string) => ipcRenderer.invoke('mpv-open', streamUrl) as Promise<void>,
  mpvStop: () => ipcRenderer.invoke('mpv-stop') as Promise<void>,
  mpvTogglePause: () => ipcRenderer.invoke('mpv-toggle-pause') as Promise<void>,
  mpvSetPause: (paused: boolean) => ipcRenderer.invoke('mpv-set-pause', paused) as Promise<void>,
  mpvSeek: (seconds: number) => ipcRenderer.invoke('mpv-seek', seconds) as Promise<void>,
  mpvSeekTo: (seconds: number) => ipcRenderer.invoke('mpv-seek-to', seconds) as Promise<void>,
  mpvSetVolume: (normalizedVolume: number) =>
    ipcRenderer.invoke('mpv-set-volume', normalizedVolume) as Promise<void>,
  mpvSetMute: (muted: boolean) => ipcRenderer.invoke('mpv-set-mute', muted) as Promise<void>,
  mpvSetAudioTrack: (trackId: number | null) =>
    ipcRenderer.invoke('mpv-set-audio-track', trackId) as Promise<void>,
  mpvSetSubtitleTrack: (trackId: number | null) =>
    ipcRenderer.invoke('mpv-set-subtitle-track', trackId) as Promise<void>,
  mpvAddSubtitleFile: (filePath: string) =>
    ipcRenderer.invoke('mpv-add-subtitle-file', filePath) as Promise<number | null>,
  mpvSetFullscreen: (fullscreen: boolean) =>
    ipcRenderer.invoke('mpv-set-fullscreen', fullscreen) as Promise<void>,
  mpvSetSubtitleStyle: (style: MpvSubtitleStyle) =>
    ipcRenderer.invoke('mpv-set-subtitle-style', style) as Promise<void>,
  mpvGetState: () => ipcRenderer.invoke('mpv-get-state') as Promise<MpvStateSnapshot>,
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  windowSetFullscreen: (fullscreen: boolean) =>
    ipcRenderer.invoke('window-set-fullscreen', fullscreen) as Promise<void>,
  windowIsFullscreen: () => ipcRenderer.invoke('window-is-fullscreen') as Promise<boolean>
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', api)
} else {
  console.warn('Context isolation is disabled; preload API will not be exposed')
}
