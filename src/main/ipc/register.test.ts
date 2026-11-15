// @vitest-environment node
import { pathToFileURL } from 'url'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  UNTRUSTED_SENDER_MESSAGE,
  createIpcRegistrar,
  isTrustedRendererUrl,
  isTrustedSenderFrame,
  type IpcMainLike
} from './register'

const rendererFileUrl = pathToFileURL(
  process.platform === 'win32' ? 'C:\\Program Files\\Abi Player\\resources\\app.asar\\out\\renderer\\index.html' : '/opt/abi/out/renderer/index.html'
).href

function fakeIpcMain() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      listeners.set(channel, listener)
    }
  }
  const invoke = (channel: string, ...args: unknown[]) =>
    Promise.resolve(listeners.get(channel)!({} as IpcMainInvokeEvent, ...args))
  return { ipcMain, invoke }
}

describe('createIpcRegistrar', () => {
  it('rejects calls from an untrusted sender without running the handler', async () => {
    const { ipcMain, invoke } = fakeIpcMain()
    const handler = vi.fn()
    createIpcRegistrar(ipcMain, () => false).handle('mpv-stop', handler)

    await expect(invoke('mpv-stop')).rejects.toThrow(UNTRUSTED_SENDER_MESSAGE)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes arguments through and masks credentials in any error', async () => {
    const { ipcMain, invoke } = fakeIpcMain()
    const registrar = createIpcRegistrar(ipcMain, () => true)
    registrar.handle('mpv-seek', (_event, seconds) => {
      if (seconds === 1) return
      throw new Error('cannot open http://p.example/live/ali/s3cret/1.ts?username=ali&password=s3cret')
    })

    await expect(invoke('mpv-seek', 1)).resolves.toBeUndefined()
    await expect(invoke('mpv-seek', 2)).rejects.toThrow(
      'cannot open http://p.example/live/***/***/1.ts?username=***&password=***'
    )
  })
})

describe('sender validation', () => {
  it('accepts only the bundled renderer document', () => {
    const location = { rendererFileUrl }
    expect(isTrustedRendererUrl(`${rendererFileUrl}#/player`, location)).toBe(true)
    expect(isTrustedRendererUrl(rendererFileUrl.replace('index.html', 'other.html'), location)).toBe(false)
    expect(isTrustedRendererUrl('https://evil.example/', location)).toBe(false)
    expect(isTrustedRendererUrl('not a url', location)).toBe(false)
  })

  it('accepts the dev server origin only when one is configured', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/#/', { rendererFileUrl, devServerUrl: 'http://localhost:5173' })).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/#/', { rendererFileUrl })).toBe(false)
  })

  it('rejects sub-frames, frames that are gone and foreign web contents', () => {
    const location = { rendererFileUrl }
    const good = { frameUrl: rendererFileUrl, isTopLevelFrame: true, belongsToAppWindow: true }
    expect(isTrustedSenderFrame(good, location)).toBe(true)
    expect(isTrustedSenderFrame({ ...good, isTopLevelFrame: false }, location)).toBe(false)
    expect(isTrustedSenderFrame({ ...good, frameUrl: null }, location)).toBe(false)
    expect(isTrustedSenderFrame({ ...good, belongsToAppWindow: false }, location)).toBe(false)
  })
})
