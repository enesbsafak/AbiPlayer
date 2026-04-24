import type {
  AppUpdateState,
  EmbeddedSubtitleExtractionResult,
  EmbeddedSubtitleProbeTrack,
  MpvStateSnapshot,
  MpvSubtitleStyle,
  MpvTrackInfo
} from '../shared/types/electron-ipc'

declare global {
  interface Window {
    electron?: {
      pickFileContent: (
        filters?: { name: string; extensions: string[] }[]
      ) => Promise<{ path: string; content: string } | null>
      getSecureCredentials: () => Promise<Record<string, { url: string; username: string; password: string }>>
      setSecureCredential: (
        sourceId: string,
        credential: { url: string; username: string; password: string }
      ) => Promise<void>
      deleteSecureCredential: (sourceId: string) => Promise<void>
      probeEmbeddedSubtitles: (streamUrl: string) => Promise<EmbeddedSubtitleProbeTrack[]>
      extractEmbeddedSubtitle: (streamUrl: string, streamIndex: number) => Promise<EmbeddedSubtitleExtractionResult | null>
      mpvIsAvailable: () => Promise<boolean>
      mpvOpen: (streamUrl: string) => Promise<void>
      mpvStop: () => Promise<void>
      mpvTogglePause: () => Promise<void>
      mpvSetPause: (paused: boolean) => Promise<void>
      mpvSeek: (seconds: number) => Promise<void>
      mpvSeekTo: (seconds: number) => Promise<void>
      mpvJumpToLive: () => Promise<void>
      mpvSetVolume: (normalizedVolume: number) => Promise<void>
      mpvSetMute: (muted: boolean) => Promise<void>
      mpvSetVideoTrack: (trackId: number | null) => Promise<void>
      mpvSetAudioTrack: (trackId: number | null) => Promise<void>
      mpvSetSubtitleTrack: (trackId: number | null) => Promise<void>
      mpvAddSubtitleFile: (filePath: string) => Promise<number | null>
      mpvSetFullscreen: (fullscreen: boolean) => Promise<void>
      mpvSetSubtitleStyle: (style: MpvSubtitleStyle) => Promise<void>
      mpvSetVideoMargin: (right: number) => Promise<void>
      mpvGetState: () => Promise<MpvStateSnapshot>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      windowSetFullscreen: (fullscreen: boolean) => Promise<void>
      windowIsFullscreen: () => Promise<boolean>
      getAppUpdateState: () => Promise<AppUpdateState>
      checkForAppUpdates: () => Promise<AppUpdateState>
      installAppUpdate: () => Promise<boolean>
      getStoreBackup: () => Promise<string | null>
      deleteStoreBackup: () => Promise<void>
      onAppUpdateStateChange: (listener: (state: AppUpdateState) => void) => () => void
    }
  }
}

export {}
