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
      probeEmbeddedSubtitles: (
        streamUrl: string
      ) => Promise<Array<{ index: number; codec: string; language?: string; title?: string }>>
      extractEmbeddedSubtitle: (
        streamUrl: string,
        streamIndex: number
      ) => Promise<{ format: 'vtt'; content: string } | null>
      mpvIsAvailable: () => Promise<boolean>
      mpvOpen: (streamUrl: string) => Promise<void>
      mpvStop: () => Promise<void>
      mpvTogglePause: () => Promise<void>
      mpvSetPause: (paused: boolean) => Promise<void>
      mpvSeek: (seconds: number) => Promise<void>
      mpvSeekTo: (seconds: number) => Promise<void>
      mpvSetVolume: (normalizedVolume: number) => Promise<void>
      mpvSetMute: (muted: boolean) => Promise<void>
      mpvSetVideoTrack: (trackId: number | null) => Promise<void>
      mpvSetAudioTrack: (trackId: number | null) => Promise<void>
      mpvSetSubtitleTrack: (trackId: number | null) => Promise<void>
      mpvAddSubtitleFile: (filePath: string) => Promise<number | null>
      mpvSetFullscreen: (fullscreen: boolean) => Promise<void>
      mpvSetSubtitleStyle: (style: {
        fontSize: number
        color: string
        background: string
      }) => Promise<void>
      mpvSetVideoMargin: (right: number) => Promise<void>
      mpvGetState: () => Promise<{
        available: boolean
        running: boolean
        paused: boolean
        buffering: boolean
        timePos: number
        duration: number
        volume: number
        muted: boolean
        vid: number | null
        aid: number | null
        sid: number | null
        fullscreen: boolean
        tracks: Array<{
          id: number
          type: 'audio' | 'sub' | 'video'
          title?: string
          lang?: string
          codec?: string
          bitrate?: number
          width?: number
          height?: number
          selected: boolean
          external: boolean
        }>
        path: string | null
        error: string | null
      }>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      windowSetFullscreen: (fullscreen: boolean) => Promise<void>
      windowIsFullscreen: () => Promise<boolean>
      getAppUpdateState: () => Promise<{
        status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
        currentVersion: string
        availableVersion: string | null
        downloadedVersion: string | null
        progress: number | null
        transferredBytes: number | null
        totalBytes: number | null
        bytesPerSecond: number | null
        message: string | null
        releaseDate: string | null
        canCheck: boolean
        updateReadyToInstall: boolean
        lastCheckedAt: number | null
      }>
      checkForAppUpdates: () => Promise<{
        status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
        currentVersion: string
        availableVersion: string | null
        downloadedVersion: string | null
        progress: number | null
        transferredBytes: number | null
        totalBytes: number | null
        bytesPerSecond: number | null
        message: string | null
        releaseDate: string | null
        canCheck: boolean
        updateReadyToInstall: boolean
        lastCheckedAt: number | null
      }>
      installAppUpdate: () => Promise<boolean>
      onAppUpdateStateChange: (listener: (state: {
        status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
        currentVersion: string
        availableVersion: string | null
        downloadedVersion: string | null
        progress: number | null
        transferredBytes: number | null
        totalBytes: number | null
        bytesPerSecond: number | null
        message: string | null
        releaseDate: string | null
        canCheck: boolean
        updateReadyToInstall: boolean
        lastCheckedAt: number | null
      }) => void) => () => void
    }
  }
}

export {}
