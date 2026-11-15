// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FILE_FILTERS,
  NOT_PICKED_MESSAGE,
  PickedFileRegistry,
  fileTooLargeMessage,
  parseFileFilters,
  readLocalTextFile,
  registerFileHandlers
} from './files'
import type { IpcHandler, IpcRegistrar } from './register'
import { decodeTextFile, decodeWindows1254 } from './text-decoding'
import type { IpcInvokeChannel } from '../../shared/ipc/contract'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'abi-files-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('decodeTextFile', () => {
  it('decodes Windows-1254 bytes that are not valid UTF-8', () => {
    // "Şişli ığdır" in cp1254
    const bytes = Uint8Array.from([0xde, 0x69, 0xfe, 0x6c, 0x69, 0x20, 0xfd, 0xf0, 0x64, 0xfd, 0x72])
    expect(decodeTextFile(bytes)).toBe('Şişli ığdır')
  })

  it('decodes the whole cp1254 Turkish set', () => {
    expect(decodeWindows1254(Uint8Array.from([0xd0, 0xdd, 0xde, 0xf0, 0xfd, 0xfe, 0xc7, 0xe7, 0xd6, 0xf6, 0xdc, 0xfc, 0x80]))).toBe(
      'ĞİŞğışÇçÖöÜü€'
    )
  })

  it('keeps valid UTF-8 as UTF-8', () => {
    expect(decodeTextFile(new TextEncoder().encode('Çığ düştü'))).toBe('Çığ düştü')
  })

  it('honours and strips byte order marks', () => {
    expect(decodeTextFile(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('A')
    expect(decodeTextFile(Uint8Array.from([0xff, 0xfe, 0x5e, 0x01, 0x41, 0x00]))).toBe('ŞA')
    expect(decodeTextFile(Uint8Array.from([0xfe, 0xff, 0x01, 0x5e, 0x00, 0x41]))).toBe('ŞA')
  })
})

describe('readLocalTextFile', () => {
  it('rejects a file over the limit with a Turkish message naming both sizes', async () => {
    const path = join(dir, 'big.srt')
    await writeFile(path, Buffer.alloc(2048, 0x41))
    await expect(readLocalTextFile(path, 1024)).rejects.toThrow(fileTooLargeMessage(2048, 1024))
    expect(fileTooLargeMessage(31 * 1024 * 1024, 25 * 1024 * 1024)).toBe(
      'Dosya çok büyük (31 MB). En fazla 25 MB boyutundaki dosyalar açılabilir.'
    )
  })

  it('names a missing file', async () => {
    await expect(readLocalTextFile(join(dir, 'gone.m3u'))).rejects.toThrow('Dosya bulunamadı: gone.m3u')
  })
})

describe('parseFileFilters', () => {
  it('falls back to the defaults and rejects malformed filters', () => {
    expect(parseFileFilters(undefined)).toBe(DEFAULT_FILE_FILTERS)
    expect(parseFileFilters([{ name: 'Altyazı', extensions: ['srt'] }])).toEqual([{ name: 'Altyazı', extensions: ['srt'] }])
    expect(() => parseFileFilters([{ name: 'x', extensions: [42] }])).toThrow('Geçersiz dosya filtresi')
    expect(() => parseFileFilters('m3u')).toThrow('Geçersiz dosya filtresi')
  })
})

describe('PickedFileRegistry', () => {
  it('remembers picks across instances and folds case on Windows', async () => {
    const storePath = join(dir, 'picked-files.json')
    const first = new PickedFileRegistry({ storePath, platform: 'win32' })
    await first.remember(join(dir, 'List.m3u'))

    expect(first.wasPickedThisSession(join(dir, 'list.M3U'))).toBe(true)

    const afterRestart = new PickedFileRegistry({ storePath, platform: 'win32' })
    expect(afterRestart.wasPickedThisSession(join(dir, 'List.m3u'))).toBe(false)
    await expect(afterRestart.wasEverPicked(join(dir, 'List.m3u'))).resolves.toBe(true)
    await expect(afterRestart.wasEverPicked(join(dir, 'other.m3u'))).resolves.toBe(false)
  })

  it('keeps only the newest picks', async () => {
    const storePath = join(dir, 'picked-files.json')
    const registry = new PickedFileRegistry({ storePath, maxRemembered: 2 })
    await registry.remember(join(dir, 'a.m3u'))
    await registry.remember(join(dir, 'b.m3u'))
    await registry.remember(join(dir, 'c.m3u'))

    const stored = JSON.parse(await readFile(storePath, 'utf-8')) as { paths: string[] }
    expect(stored.paths).toEqual([join(dir, 'c.m3u'), join(dir, 'b.m3u')])
  })

  it('ignores an unreadable store', async () => {
    const storePath = join(dir, 'picked-files.json')
    await writeFile(storePath, '{not json', 'utf-8')
    await expect(new PickedFileRegistry({ storePath }).wasEverPicked(join(dir, 'a.m3u'))).resolves.toBe(false)
  })
})

type AnyHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function captureHandlers(): { registrar: IpcRegistrar; call: (channel: IpcInvokeChannel, ...args: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, AnyHandler>()
  const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent
  return {
    registrar: {
      handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>) {
        handlers.set(channel, handler as unknown as AnyHandler)
      }
    },
    call: async (channel, ...args) => handlers.get(channel)!(event, ...args)
  }
}

describe('file handlers', () => {
  // F1-27: a local M3U source can be re-read at start-up, but only by a path
  // the user picked through the dialog.
  it('re-reads only previously picked paths', async () => {
    const playlist = join(dir, 'liste.m3u')
    const secret = join(dir, 'secret.txt')
    await writeFile(playlist, '#EXTM3U\n', 'utf-8')
    await writeFile(secret, 'top secret', 'utf-8')

    const registry = new PickedFileRegistry({ storePath: join(dir, 'picked-files.json') })
    const { registrar, call } = captureHandlers()
    registerFileHandlers(registrar, {
      registry,
      getWindow: () => ({}) as Electron.BrowserWindow,
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [playlist] })
    })

    await expect(call('read-picked-file', playlist)).rejects.toThrow(NOT_PICKED_MESSAGE)
    await expect(call('pick-file-content')).resolves.toEqual({ path: playlist, content: '#EXTM3U\n' })
    await expect(call('read-picked-file', playlist)).resolves.toEqual({ path: playlist, content: '#EXTM3U\n' })
    await expect(call('read-picked-file', secret)).rejects.toThrow(NOT_PICKED_MESSAGE)
    await expect(call('read-picked-file', 42)).rejects.toThrow('Geçersiz dosya yolu')
  })

  it('returns null when the dialog is cancelled', async () => {
    const { registrar, call } = captureHandlers()
    registerFileHandlers(registrar, {
      registry: new PickedFileRegistry({ storePath: join(dir, 'picked-files.json') }),
      getWindow: () => ({}) as Electron.BrowserWindow,
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
    })
    await expect(call('pick-file-content')).resolves.toBeNull()
  })
})
