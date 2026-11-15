import { readFile as fsReadFile, stat as fsStat } from 'fs/promises'
import { basename, resolve } from 'path'
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { MAX_LOCAL_FILE_SIZE_BYTES, type FileFilter, type PickedFile } from '../../shared/ipc/contract'
import { writeFileAtomic } from './atomic-file'
import type { IpcRegistrar } from './register'
import { decodeTextFile } from './text-decoding'

const MAX_FILTERS = 10
const MAX_EXTENSIONS_PER_FILTER = 20
const MAX_FILTER_TEXT_LENGTH = 64
const MAX_PATH_LENGTH = 4096

export const DEFAULT_FILE_FILTERS: FileFilter[] = [
  { name: 'Oynatma Listesi Dosyaları', extensions: ['m3u', 'm3u8', 'txt'] },
  { name: 'Altyazı Dosyaları', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
  { name: 'Tüm Dosyalar', extensions: ['*'] }
]

export function parseFileFilters(value: unknown): FileFilter[] {
  if (value === undefined || value === null) return DEFAULT_FILE_FILTERS
  const isText = (text: unknown): text is string =>
    typeof text === 'string' && text.length > 0 && text.length <= MAX_FILTER_TEXT_LENGTH

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_FILTERS ||
    !value.every(
      (filter) =>
        filter &&
        typeof filter === 'object' &&
        isText((filter as FileFilter).name) &&
        Array.isArray((filter as FileFilter).extensions) &&
        (filter as FileFilter).extensions.length > 0 &&
        (filter as FileFilter).extensions.length <= MAX_EXTENSIONS_PER_FILTER &&
        (filter as FileFilter).extensions.every(isText)
    )
  ) {
    throw new Error('Geçersiz dosya filtresi')
  }

  return (value as FileFilter[]).map((filter) => ({ name: filter.name, extensions: [...filter.extensions] }))
}

export function isValidFilePathArgument(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_PATH_LENGTH
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 10 ? Math.round(mb).toString() : mb.toFixed(1).replace('.', ',')
}

export function fileTooLargeMessage(sizeBytes: number, limitBytes: number): string {
  return `Dosya çok büyük (${formatMegabytes(sizeBytes)} MB). En fazla ${formatMegabytes(limitBytes)} MB boyutundaki dosyalar açılabilir.`
}

export interface TextFileReadOps {
  stat(path: string): Promise<{ size: number }>
  readFile(path: string): Promise<Uint8Array>
}

const nodeTextFileOps: TextFileReadOps = {
  stat: (path) => fsStat(path),
  readFile: (path) => fsReadFile(path)
}

/** Reads a playlist or subtitle file for the renderer: size-capped, with encoding detection. */
export async function readLocalTextFile(
  filePath: string,
  maxBytes: number = MAX_LOCAL_FILE_SIZE_BYTES,
  ops: TextFileReadOps = nodeTextFileOps
): Promise<string> {
  let size: number
  try {
    size = (await ops.stat(filePath)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`Dosya bulunamadı: ${basename(filePath)}`)
    }
    throw error
  }
  if (size > maxBytes) throw new Error(fileTooLargeMessage(size, maxBytes))

  const bytes = await ops.readFile(filePath)
  // The file may have grown between stat and read.
  if (bytes.length > maxBytes) throw new Error(fileTooLargeMessage(bytes.length, maxBytes))
  return decodeTextFile(bytes)
}

export interface PickedFileRegistryOptions {
  /** JSON file under userData that remembers picks across restarts. */
  storePath: string
  platform?: NodeJS.Platform
  maxRemembered?: number
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, data: string) => Promise<void>
}

interface PickedFileStoreData {
  version: 1
  paths: string[]
}

/**
 * Paths the user chose in our own open-file dialog.
 *
 * - `wasPickedThisSession`: gate for handing a path to mpv. A compromised
 *   renderer must not be able to make mpv open arbitrary local paths.
 * - `wasEverPicked`: gate for re-reading a local M3U at start-up; persisted so
 *   it survives a restart, and only ever contains paths the user picked.
 */
export class PickedFileRegistry {
  private readonly sessionKeys = new Set<string>()
  private remembered: string[] = []
  private loadPromise: Promise<void> | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private readonly platform: NodeJS.Platform
  private readonly maxRemembered: number
  private readonly readStore: (path: string) => Promise<string>
  private readonly writeStore: (path: string, data: string) => Promise<void>

  constructor(private readonly options: PickedFileRegistryOptions) {
    this.platform = options.platform ?? process.platform
    this.maxRemembered = options.maxRemembered ?? 100
    this.readStore = options.readFile ?? ((path) => fsReadFile(path, 'utf-8'))
    this.writeStore = options.writeFile ?? ((path, data) => writeFileAtomic(path, data))
  }

  private key(filePath: string): string {
    const absolute = resolve(filePath)
    return this.platform === 'win32' ? absolute.toLowerCase() : absolute
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const parsed = JSON.parse(await this.readStore(this.options.storePath)) as Partial<PickedFileStoreData>
          if (Array.isArray(parsed.paths)) {
            this.remembered = parsed.paths
              .filter((path): path is string => isValidFilePathArgument(path))
              .slice(0, this.maxRemembered)
          }
        } catch {
          // Missing or unreadable: start with an empty list.
        }
      })()
    }
    return this.loadPromise
  }

  async remember(filePath: string): Promise<void> {
    this.sessionKeys.add(this.key(filePath))
    await this.ensureLoaded()

    const key = this.key(filePath)
    this.remembered = [filePath, ...this.remembered.filter((path) => this.key(path) !== key)].slice(
      0,
      this.maxRemembered
    )

    const data: PickedFileStoreData = { version: 1, paths: this.remembered }
    const write = this.writeChain.then(() => this.writeStore(this.options.storePath, JSON.stringify(data)))
    this.writeChain = write.catch(() => undefined)
    try {
      await write
    } catch (error) {
      // Re-reading after a restart will not work for this file, but the pick
      // itself succeeded; do not fail it.
      console.warn('[files] could not persist picked file list:', error)
    }
  }

  wasPickedThisSession(filePath: string): boolean {
    return this.sessionKeys.has(this.key(filePath))
  }

  async wasEverPicked(filePath: string): Promise<boolean> {
    if (this.wasPickedThisSession(filePath)) return true
    await this.ensureLoaded()
    const key = this.key(filePath)
    return this.remembered.some((path) => this.key(path) === key)
  }
}

export interface FileHandlerDeps {
  registry: PickedFileRegistry
  getWindow: (sender: Electron.WebContents) => BrowserWindow | null
  showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
  readTextFile?: (filePath: string) => Promise<string>
}

export const NOT_PICKED_MESSAGE = 'Bu dosyayı okuma izni yok. Dosyayı yeniden seçin.'

export function registerFileHandlers(registrar: IpcRegistrar, deps: FileHandlerDeps): void {
  const readText = deps.readTextFile ?? ((filePath: string) => readLocalTextFile(filePath))

  registrar.handle('pick-file-content', async (event, filters): Promise<PickedFile | null> => {
    const parsedFilters = parseFileFilters(filters)
    const window = deps.getWindow(event.sender)
    if (!window) return null

    const result = await deps.showOpenDialog(window, {
      properties: ['openFile'],
      filters: parsedFilters
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const content = await readText(filePath)
    await deps.registry.remember(filePath)
    return { path: filePath, content }
  })

  registrar.handle('read-picked-file', async (_event, filePath): Promise<PickedFile> => {
    if (!isValidFilePathArgument(filePath)) throw new Error('Geçersiz dosya yolu')
    if (!(await deps.registry.wasEverPicked(filePath))) throw new Error(NOT_PICKED_MESSAGE)
    return { path: filePath, content: await readText(filePath) }
  })
}
