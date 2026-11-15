import { CACHE_DB_NAME, type CacheChunk, type CacheManifest } from './schema'
import { requests } from '@/strings/requests'

/**
 * Storage under the catalog cache: two key-value stores (manifests, chunks).
 * Each method is one transaction; `publish` is the only one that touches the
 * manifests, so a manifest switch is atomic.
 */
export interface CacheBackend {
  getManifest(key: string): Promise<CacheManifest | undefined>
  listManifests(): Promise<CacheManifest[]>
  /** Which of `keys` exist. */
  existingChunks(keys: readonly string[]): Promise<Set<string>>
  getChunks(keys: readonly string[]): Promise<Array<CacheChunk | undefined>>
  putChunks(chunks: readonly CacheChunk[]): Promise<void>
  deleteChunks(keys: readonly string[]): Promise<void>
  listChunkKeys(): Promise<string[]>
  /** One transaction: writes `put`, deletes `remove`. */
  publish(put: readonly CacheManifest[], remove: readonly string[]): Promise<void>
  /** Drops everything. */
  clear(): Promise<void>
  close(): void
}

export class CacheQuotaError extends Error {
  constructor(cause?: unknown) {
    super(requests.cache.quota, cause === undefined ? undefined : { cause })
    this.name = 'CacheQuotaError'
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}

/**
 * In-memory backend for tests. `faults` lets a test make writes fail
 * (quota) or stop (crash) at a chosen point.
 */
export class MemoryCacheBackend implements CacheBackend {
  readonly manifests = new Map<string, CacheManifest>()
  readonly chunks = new Map<string, CacheChunk>()
  /** Chunk writes that succeed before the next one throws a quota error; null = never. */
  quotaAfterChunks: number | null = null
  /** Make the next `publish` throw (a crash before the manifest switch). */
  failNextPublish = false
  chunkWrites = 0

  private clone<T>(value: T): T {
    return structuredClone(value)
  }

  async getManifest(key: string) {
    const manifest = this.manifests.get(key)
    return manifest ? this.clone(manifest) : undefined
  }

  async listManifests() {
    return [...this.manifests.values()].map((manifest) => this.clone(manifest))
  }

  async existingChunks(keys: readonly string[]) {
    return new Set(keys.filter((key) => this.chunks.has(key)))
  }

  async getChunks(keys: readonly string[]) {
    return keys.map((key) => {
      const chunk = this.chunks.get(key)
      return chunk ? this.clone(chunk) : undefined
    })
  }

  async putChunks(chunks: readonly CacheChunk[]) {
    // One transaction: all or nothing.
    if (this.quotaAfterChunks !== null && this.chunkWrites + chunks.length > this.quotaAfterChunks) {
      throw new CacheQuotaError()
    }
    for (const chunk of chunks) this.chunks.set(chunk.key, this.clone(chunk))
    this.chunkWrites += chunks.length
  }

  async deleteChunks(keys: readonly string[]) {
    for (const key of keys) this.chunks.delete(key)
  }

  async listChunkKeys() {
    return [...this.chunks.keys()]
  }

  async publish(put: readonly CacheManifest[], remove: readonly string[]) {
    if (this.failNextPublish) {
      this.failNextPublish = false
      throw new Error('simulated crash before publish')
    }
    for (const key of remove) this.manifests.delete(key)
    for (const manifest of put) this.manifests.set(manifest.key, this.clone(manifest))
  }

  async clear() {
    this.manifests.clear()
    this.chunks.clear()
  }

  close() {}
}

const DB_VERSION = 1
const MANIFESTS = 'manifests'
const CHUNKS = 'chunks'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(isQuotaError(tx.error) ? new CacheQuotaError(tx.error) : (tx.error ?? new Error('IndexedDB transaction aborted')))
    tx.onerror = () => undefined
  })
}

/** IndexedDB backend, used inside the catalog worker. */
export class IdbCacheBackend implements CacheBackend {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = CACHE_DB_NAME): Promise<IdbCacheBackend> {
    const openRequest = indexedDB.open(name, DB_VERSION)
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result
      // A structural change discards the cache rather than migrating it.
      for (const store of Array.from(db.objectStoreNames)) db.deleteObjectStore(store)
      db.createObjectStore(MANIFESTS, { keyPath: 'key' })
      db.createObjectStore(CHUNKS, { keyPath: 'key' })
    }
    const db = await request(openRequest)
    // Another version of the app wants the database: let it.
    db.onversionchange = () => db.close()
    return new IdbCacheBackend(db)
  }

  async getManifest(key: string) {
    const tx = this.db.transaction(MANIFESTS, 'readonly')
    return (await request(tx.objectStore(MANIFESTS).get(key))) as CacheManifest | undefined
  }

  async listManifests() {
    const tx = this.db.transaction(MANIFESTS, 'readonly')
    return (await request(tx.objectStore(MANIFESTS).getAll())) as CacheManifest[]
  }

  async existingChunks(keys: readonly string[]) {
    if (keys.length === 0) return new Set<string>()
    const tx = this.db.transaction(CHUNKS, 'readonly')
    const store = tx.objectStore(CHUNKS)
    const found = await Promise.all(keys.map((key) => request(store.getKey(key))))
    return new Set(keys.filter((_key, index) => found[index] !== undefined))
  }

  async getChunks(keys: readonly string[]) {
    if (keys.length === 0) return []
    const tx = this.db.transaction(CHUNKS, 'readonly')
    const store = tx.objectStore(CHUNKS)
    return (await Promise.all(keys.map((key) => request(store.get(key))))) as Array<CacheChunk | undefined>
  }

  async putChunks(chunks: readonly CacheChunk[]) {
    if (chunks.length === 0) return
    const tx = this.db.transaction(CHUNKS, 'readwrite')
    const store = tx.objectStore(CHUNKS)
    for (const chunk of chunks) store.put(chunk)
    await done(tx)
  }

  async deleteChunks(keys: readonly string[]) {
    if (keys.length === 0) return
    const tx = this.db.transaction(CHUNKS, 'readwrite')
    const store = tx.objectStore(CHUNKS)
    for (const key of keys) store.delete(key)
    await done(tx)
  }

  async listChunkKeys() {
    const tx = this.db.transaction(CHUNKS, 'readonly')
    return (await request(tx.objectStore(CHUNKS).getAllKeys())) as string[]
  }

  async publish(put: readonly CacheManifest[], remove: readonly string[]) {
    const tx = this.db.transaction(MANIFESTS, 'readwrite')
    const store = tx.objectStore(MANIFESTS)
    for (const key of remove) store.delete(key)
    for (const manifest of put) store.put(manifest)
    await done(tx)
  }

  async clear() {
    const tx = this.db.transaction([MANIFESTS, CHUNKS], 'readwrite')
    tx.objectStore(MANIFESTS).clear()
    tx.objectStore(CHUNKS).clear()
    await done(tx)
  }

  close() {
    this.db.close()
  }
}
