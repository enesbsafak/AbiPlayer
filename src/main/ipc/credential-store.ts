import { randomBytes } from 'crypto'
import { readFile, rename } from 'fs/promises'
import { basename } from 'path'
import type { SecureCredentialMap, SecureCredentialsLossNotice, SecureSourceSecret } from '../../shared/ipc/contract'
import {
  isValidCredential,
  isValidSourceId,
  isValidSourceSecret,
  isValidTmdbApiKey,
  sanitizeCredentialMap
} from '../../shared/secure-credentials'
import { nodeAtomicWriteOps, writeFileAtomic, type AtomicWriteOps } from './atomic-file'
import { mainStrings } from '../../shared/main-strings'

/**
 * Electron's asynchronous safeStorage (the synchronous methods are deprecated
 * in Electron 45 and removed in 46). Files written by the synchronous
 * `encryptString` decrypt with `decryptStringAsync`.
 */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
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

export { isValidCredential, isValidSourceId, isValidSourceSecret, isValidTmdbApiKey }

/**
 * Property of the stored JSON that holds the catalog cache key. Not a valid
 * source id in practice (ids are generated), and an entry of the wrong shape
 * for `sanitizeCredentialMap`, so older versions simply drop it.
 */
const CACHE_KEY_FIELD = '\u0000catalogCacheKey'
const CACHE_KEY_BYTES = 32
/** The TMDB API key, kept the same way (and dropped the same way by older versions). */
const TMDB_KEY_FIELD = '\u0000tmdbApiKey'

function isCacheKey(value: unknown): value is string {
  return typeof value === 'string' && Buffer.from(value, 'base64').length === CACHE_KEY_BYTES
}

interface StoreContents {
  secrets: SecureCredentialMap
  cacheKey: string | null
  tmdbApiKey: string | null
}

interface DecodedContents {
  contents: StoreContents
  /** safeStorage rotated its key: the file should be written again with the new one. */
  shouldReEncrypt: boolean
}

const EMPTY_CONTENTS = (): StoreContents => ({ secrets: {}, cacheKey: null, tmdbApiKey: null })

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
    return this.withLock(async () => (await this.read()).secrets)
  }

  set(sourceId: string, credential: SecureSourceSecret): Promise<void> {
    return this.withLock(async () => {
      const store = await this.read()
      store.secrets[sourceId] = credential
      await this.write(store)
    })
  }

  delete(sourceId: string): Promise<void> {
    return this.withLock(async () => {
      const store = await this.read()
      if (!(sourceId in store.secrets)) return
      delete store.secrets[sourceId]
      await this.write(store)
    })
  }

  /**
   * The key that seals the renderer's cached M3U data (base64). Made once and
   * kept in this encrypted file, so it is exactly as protected as the stored
   * logins and is lost with them when the file is quarantined.
   */
  getCacheKey(): Promise<string> {
    return this.withLock(async () => {
      const store = await this.read()
      if (store.cacheKey) return store.cacheKey
      store.cacheKey = randomBytes(CACHE_KEY_BYTES).toString('base64')
      await this.write(store)
      return store.cacheKey
    })
  }

  getTmdbApiKey(): Promise<string | null> {
    return this.withLock(async () => (await this.read()).tmdbApiKey)
  }

  /** Stores the TMDB API key; null removes it. */
  setTmdbApiKey(apiKey: string | null): Promise<void> {
    return this.withLock(async () => {
      const store = await this.read()
      if (store.tmdbApiKey === apiKey) return
      store.tmdbApiKey = apiKey
      await this.write(store)
    })
  }

  private async ensureAvailable(): Promise<void> {
    if (!(await this.options.safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error(mainStrings.credentials.unavailable)
    }
  }

  private async read(): Promise<StoreContents> {
    await this.ensureAvailable()

    let encryptedBase64: string
    try {
      encryptedBase64 = await this.fs.readFile(this.options.filePath)
    } catch (error) {
      // Only a missing file means "no credentials". Other I/O errors (a lock
      // held by an antivirus scan, say) are transient and must not cost the
      // user their stored logins.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return EMPTY_CONTENTS()
      throw error
    }

    if (encryptedBase64.trim().length === 0) return EMPTY_CONTENTS()

    let decoded: DecodedContents
    try {
      decoded = await this.decode(encryptedBase64)
    } catch (error) {
      if (!(error instanceof UnreadableStoreError)) throw error
      await this.quarantine(error.reason)
      return EMPTY_CONTENTS()
    }
    if (decoded.shouldReEncrypt) {
      try {
        await this.write(decoded.contents)
      } catch (error) {
        // The old encryption still reads; the next write tries again.
        console.warn('[credentials] could not re-encrypt the credential file:', error)
      }
    }
    return decoded.contents
  }

  private async decode(encryptedBase64: string): Promise<DecodedContents> {
    const encrypted = Buffer.from(encryptedBase64, 'base64')
    if (encrypted.length === 0) throw new UnreadableStoreError('corrupt')

    let decrypted: string
    let shouldReEncrypt: boolean
    try {
      ;({ result: decrypted, shouldReEncrypt } = await this.options.safeStorage.decryptStringAsync(encrypted))
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

    const cacheKey = (parsed as Record<string, unknown>)[CACHE_KEY_FIELD]
    const tmdbApiKey = (parsed as Record<string, unknown>)[TMDB_KEY_FIELD]
    return {
      contents: {
        secrets: sanitizeCredentialMap(parsed),
        cacheKey: isCacheKey(cacheKey) ? cacheKey : null,
        tmdbApiKey: isValidTmdbApiKey(tmdbApiKey) ? tmdbApiKey : null
      },
      shouldReEncrypt
    }
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

  private async write(store: StoreContents): Promise<void> {
    await this.ensureAvailable()
    const payload: Record<string, unknown> = { ...store.secrets }
    if (store.cacheKey) payload[CACHE_KEY_FIELD] = store.cacheKey
    if (store.tmdbApiKey) payload[TMDB_KEY_FIELD] = store.tmdbApiKey
    const encrypted = (await this.options.safeStorage.encryptStringAsync(JSON.stringify(payload))).toString('base64')
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
        reject(new Error(mainStrings.credentials.lockTimeout))
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
