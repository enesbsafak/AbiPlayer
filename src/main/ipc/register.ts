import type { IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcInvokeChannel, IpcResult } from '../../shared/ipc/contract'
import { maskCredentials } from '../../shared/mask-credentials'
import { mainStrings } from '../../shared/main-strings'

/**
 * Renderer arguments arrive untyped and untrusted: each handler receives them
 * as `unknown`, in the positions the contract declares, and validates them.
 */
type AsUnknown<T> = T extends unknown[] ? { [I in keyof T]: unknown } : never

export type UntrustedArgs<C extends IpcInvokeChannel> = AsUnknown<IpcArgs<C>>

export type IpcHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: UntrustedArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

export interface IpcRegistrar {
  handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>): void
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
}

export const UNTRUSTED_SENDER_MESSAGE = mainStrings.app.untrustedSender

/**
 * Wraps `ipcMain.handle` so every handler (1) rejects calls that do not come
 * from the app's own top-level frame and (2) never lets an account name or
 * password out in an error message.
 */
export function createIpcRegistrar(
  ipcMain: IpcMainLike,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
): IpcRegistrar {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedSender(event)) {
          throw new Error(UNTRUSTED_SENDER_MESSAGE)
        }
        try {
          return await handler(event, ...(args as UntrustedArgs<typeof channel>))
        } catch (error) {
          throw toMaskedError(error)
        }
      })
    }
  }
}

export function toMaskedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(maskCredentials(message))
}

export interface TrustedRendererLocation {
  /** `file://…/renderer/index.html` of the packaged build. */
  rendererFileUrl: string
  /** electron-vite dev server URL, only in development. */
  devServerUrl?: string
}

/**
 * True when `url` is the app's own renderer document: the bundled index.html,
 * or in development the dev server's origin. Query and hash are ignored —
 * the router uses the hash.
 */
export function isTrustedRendererUrl(url: string, location: TrustedRendererLocation): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (location.devServerUrl) {
    try {
      if (parsed.origin === new URL(location.devServerUrl).origin) return true
    } catch {
      // fall through to the file check
    }
  }

  if (parsed.protocol !== 'file:') return false
  const expected = new URL(location.rendererFileUrl)
  return normalizeFilePathname(parsed.pathname) === normalizeFilePathname(expected.pathname)
}

function normalizeFilePathname(pathname: string): string {
  // Windows paths are case-insensitive and Chromium may percent-encode
  // differently from Node's pathToFileURL.
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // keep the raw form
  }
  return process.platform === 'win32' ? decoded.toLowerCase() : decoded
}

export interface SenderFrameInfo {
  /** null when the frame is gone (navigated away or destroyed). */
  frameUrl: string | null
  isTopLevelFrame: boolean
  belongsToAppWindow: boolean
}

export function isTrustedSenderFrame(info: SenderFrameInfo, location: TrustedRendererLocation): boolean {
  if (!info.belongsToAppWindow || !info.isTopLevelFrame || !info.frameUrl) return false
  return isTrustedRendererUrl(info.frameUrl, location)
}
