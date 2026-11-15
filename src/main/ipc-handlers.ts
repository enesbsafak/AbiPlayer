import { app, BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { spawn } from 'child_process'
import { join } from 'path'
import { pathToFileURL } from 'url'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { MpvController } from './mpv-controller'
import { resolveUnpackedBinary } from './unpacked-binary'
import { registerAppHandlers } from './ipc/app'
import { CredentialStore } from './ipc/credential-store'
import { registerCredentialHandlers } from './ipc/credentials'
import { broadcastEvent } from './ipc/events'
import { PickedFileRegistry, registerFileHandlers } from './ipc/files'
import { registerMediaHandlers, mediaJobOwner } from './ipc/media'
import { createMediaService, MediaJobRunner } from './ipc/media-jobs'
import { createMpvPrewarmTrigger, getNativeWindowId, registerMpvHandlers } from './ipc/mpv'
import { createIpcRegistrar, isTrustedSenderFrame, type TrustedRendererLocation } from './ipc/register'
import { registerWindowHandlers } from './ipc/window'

const mpvController = new MpvController()

export interface MainServices {
  stopPlayback(): Promise<void>
  shutdown(): Promise<void>
  /** Synchronous last resort on exit: no mpv process may outlive the app. */
  killPlayerProcesses(): void
  /** Tell it when `window` has been shown and each time its page has loaded. */
  createPlayerPrewarm(window: BrowserWindow): { windowShown(): void; pageLoaded(): void }
  cancelMediaJobs(webContentsId: number): void
  trustedRendererLocation: TrustedRendererLocation
}

function getSenderWindow(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender)
}

export function getTrustedRendererLocation(): TrustedRendererLocation {
  const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  return {
    rendererFileUrl: pathToFileURL(join(__dirname, '../renderer/index.html')).href,
    ...(devServerUrl ? { devServerUrl } : {})
  }
}

export function registerIpcHandlers(): MainServices {
  const trustedRendererLocation = getTrustedRendererLocation()

  const registrar = createIpcRegistrar(ipcMain, (event: IpcMainInvokeEvent) => {
    try {
      const frame = event.senderFrame
      return isTrustedSenderFrame(
        {
          frameUrl: frame ? frame.url : null,
          isTopLevelFrame: frame ? frame.parent === null : false,
          belongsToAppWindow: getSenderWindow(event.sender) !== null
        },
        trustedRendererLocation
      )
    } catch {
      // A frame disposed mid-call throws on property access.
      return false
    }
  })

  const userData = app.getPath('userData')

  const credentialStore = new CredentialStore({
    filePath: join(userData, 'secure-credentials.dat'),
    safeStorage,
    onLoss: (notice) => {
      console.warn('[credentials] unreadable credential file moved aside:', notice)
      broadcastEvent(
        BrowserWindow.getAllWindows()
          .filter((window) => !window.isDestroyed())
          .map((window) => window.webContents),
        'secure-credentials-lost',
        notice
      )
    }
  })

  const pickedFiles = new PickedFileRegistry({ storePath: join(userData, 'picked-files.json') })

  const media = createMediaService({
    runner: new MediaJobRunner((executable, args) =>
      spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    ),
    ffprobePath: resolveUnpackedBinary(ffprobeStatic.path),
    ffmpegPath: resolveUnpackedBinary(ffmpegPath)
  })

  registerAppHandlers(registrar)
  registerCredentialHandlers(registrar, credentialStore)
  registerFileHandlers(registrar, {
    registry: pickedFiles,
    getWindow: getSenderWindow,
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options)
  })
  registerMediaHandlers(registrar, media)
  registerWindowHandlers(registrar, getSenderWindow)
  registerMpvHandlers(registrar, {
    controller: mpvController,
    registry: pickedFiles,
    getWindow: getSenderWindow
  })

  return {
    stopPlayback: () => mpvController.stopPlayback(),
    shutdown: async () => {
      media.cancelAll()
      await mpvController.shutdown()
    },
    killPlayerProcesses: () => mpvController.killProcessesNow(),
    createPlayerPrewarm: (window) =>
      createMpvPrewarmTrigger({
        controller: mpvController,
        getWindowId: () => (window.isDestroyed() ? null : getNativeWindowId(window))
      }),
    cancelMediaJobs: (webContentsId) => {
      media.cancel(mediaJobOwner({ id: webContentsId }))
    },
    trustedRendererLocation
  }
}
