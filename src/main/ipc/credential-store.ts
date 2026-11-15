import { readFile, rename } from 'fs/promises'
import { basename } from 'path'
import type { SecureXtreamCredentials } from '../../shared/types/electron-ipc'
import type { SecureCredentialMap, SecureCredentialsLossNotice } from '../../shared/ipc/contract'
import { isValidCredential, isValidSourceId, sanitizeCredentialMap } from '../../shared/secure-credentials'
import { nodeAtomicWriteOps, writeFileAtomic, type AtomicWriteOps } from './atomic-file'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface CredentialStoreFs extends AtomicWriteOps {
  readFile(path: string): Promise<string>
}

export interface CredentialStoreOptions {
  filePath: string
  safeStorage: SafeStorageLike
  fs?: CredentialStoreFs
  now?: () => number
  lockTimeoutMs?: number
  /** Called once per run, the first time an unreadable file is moved aside. */
  onLoss?: (notice: SecureCredentialsLossNotice) => void
}

const DEFAULT_LOCK_TIMEOUT_MS = 15_000

const nodeCredentialFs: CredentialStoreFs = {
  ...nodeAtomicWriteOps,
  readFile: (path) => readFile(path, 'utf-8'),
  rename: (from, to) => rename(from, to)
}

export { isValidCredential, isValidSourceId }

class UnreadableStoreError extends Error {
  constructor(readonly reason: SecureCredentialsLossNotice['reason']) {
    super(reason)
  }
}

function quarantineTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-')
}

/**
 * The encrypted per-source Xtream credential file.
 *
 * A file that exists but cannot be decrypted or parsed used to make every
 * read throw, and since set/delete read first, saving was locked out for good.
 * Such a file is now renamed aside (kept, in case it can be recovered) and
 * treated as empty, and the renderer is told the stored logins were lost.
 */
export class CredentialStore {
  private readonly fs: CredentialStoreFs
  private readonly now: () => number
  private readonly lockTimeoutMs: number
  private lock: Promise<void> = Promise.resolve()
  private lossNotice: SecureCredentialsLossNotice | null = null

  constructor(private readonly options: CredentialStoreOptions) {
    this.fs = options.fs ?? nodeCredentialFs
    this.now = options.now ?? Date.now
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  }

  getLossNotice(): SecureCredentialsLossNotice | null {
    return this.lossNotice ? { ...this.lossNotice } : null
  }

  getAll(): Promise<SecureCredentialMap> {
    return this.withLock(() => this.read())
  }

  set(sourceId: string, credential: SecureXtreamCredentials): Promise<void> {
    return this.withLock(async () => {
      const store = await this.read()
      store[sourceId] = credential
      await this.write(store)
    })
  }

  delete(sourceId: string): Promise<void> {
    return this.withLock(async () => {
      const store = await this.read()
      if (!(sourceId in store)) return
      delete store[sourceId]
      await this.write(store)
    })
  }

  private ensureAvailable(): void {
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      throw new Error('Güvenli kimlik bilgisi saklama bu sistemde kullanılamıyor')
    }
  }

  private async read(): Promise<SecureCredentialMap> {
    this.ensureAvailable()

    let encryptedBase64: string
    try {
      encryptedBase64 = await this.fs.readFile(this.options.filePath)
    } catch (error) {
      // Only a missing file means "no credentials". Other I/O errors (a lock
      // held by an antivirus scan, say) are transient and must not cost the
      // user their stored logins.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return {}
      throw error
    }

    if (encryptedBase64.trim().length === 0) return {}

    try {
      return this.decode(encryptedBase64)
    } catch (error) {
      if (!(error instanceof UnreadableStoreError)) throw error
      await this.quarantine(error.reason)
      return {}
    }
  }

  private decode(encryptedBase64: string): SecureCredentialMap {
    const encrypted = Buffer.from(encryptedBase64, 'base64')
    if (encrypted.length === 0) throw new UnreadableStoreError('corrupt')

    let decrypted: string
    try {
      decrypted = this.options.safeStorage.decryptString(encrypted)
    } catch {
      throw new UnreadableStoreError('decrypt-failed')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(decrypted)
    } catch {
      throw new UnreadableStoreError('corrupt')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UnreadableStoreError('corrupt')
    }

    return sanitizeCredentialMap(parsed)
  }

  private async quarantine(reason: SecureCredentialsLossNotice['reason']): Promise<void> {
    const lostAt = this.now()
    const target = `${this.options.filePath}.unreadable-${quarantineTimestamp(lostAt)}`
    let quarantinedAs: string | null = null
    try {
      await this.fs.rename(this.options.filePath, target)
      quarantinedAs = basename(target)
    } catch (error) {
      // The next successful write replaces the file atomically, so saving
      // still works; only the copy for later recovery is lost.
      console.warn('[credentials] could not move unreadable credential file aside:', error)
    }

    if (this.lossNotice) return
    this.lossNotice = { lostAt, reason, quarantinedAs }
    this.options.onLoss?.({ ...this.lossNotice })
  }

  private async write(store: SecureCredentialMap): Promise<void> {
    this.ensureAvailable()
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(store)).toString('base64')
    await writeFileAtomic(this.options.filePath, encrypted, this.fs)
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previousLock = this.lock
    let releaseCurrent: () => void = () => undefined
    this.lock = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })

    // If the previous holder hangs (a read that never settles), stop waiting
    // so credential IPC is never stuck for good.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Kimlik bilgisi kilidi zaman aşımına uğradı'))
      }, this.lockTimeoutMs)
    })

    try {
      try {
        await Promise.race([previousLock, timeoutPromise])
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
      return await fn()
    } finally {
      // Always release, otherwise the next caller waits on a broken chain.
      releaseCurrent()
    }
  }
}
