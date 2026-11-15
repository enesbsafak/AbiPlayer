import { itemAt } from '../../../../shared/checked'
import type { CatalogCategory, CatalogItem, CatalogType } from '../types'
import type { CacheBackend } from './backend'
import { hash53, planChunks, slices, type ChunkingOptions, DEFAULT_CHUNKING } from './chunking'
import type { CacheCipher, SealedBlob } from './cipher'
import {
  CACHE_SCHEMA_VERSION,
  chunkKey,
  manifestKey,
  sourcePrefix,
  type CacheChunk,
  type CacheManifest,
  type CachePartition
} from './schema'

/** What the cache knows a source by; turned into a fingerprint (never stored in clear). */
export type SourceIdentity =
  | { kind: 'xtream'; url: string; username: string }
  | { kind: 'm3u_url'; url: string }
  | { kind: 'm3u_file'; path: string }

/** M3U data must be sealed; Xtream records carry no credentials. */
export function isSealedIdentity(identity: SourceIdentity): boolean {
  return identity.kind !== 'xtream'
}

export interface PartitionWrite {
  partition: CatalogType
  items: readonly CatalogItem[]
  /** null: keep no category list (none was known). */
  categories: readonly CatalogCategory[] | null
}

export interface CacheWriteRequest {
  sourceId: string
  identity: SourceIdentity
  /** The in-memory revision the data was fetched under; see `dropSource`. */
  sourceRevision: number
  fetchedAt: number
  /** Published together, in one manifest transaction (an M3U source's three types). */
  partitions: readonly PartitionWrite[]
  /** Sealed into the manifests (M3U: the playlist's EPG URLs). */
  extra?: unknown
  /** Checked right before the manifest switch: false drops the write (the job was cancelled). */
  shouldPublish?: () => boolean
}

export interface CacheWriteReport {
  published: boolean
  /** Why nothing was published. */
  skipped?: 'removed' | 'cancelled' | 'no-key' | 'quota' | 'failed'
  recordsTotal: number
  chunksTotal: number
  /** Chunks that were not stored already and had to be written. */
  chunksWritten: number
  /** Records inside the written chunks. */
  recordsWritten: number
}

export interface CachedPartition {
  partition: CatalogType
  manifest: CacheManifest
}

export type CacheReadResult =
  | { status: 'hit'; partitions: CachedPartition[]; extra: unknown }
  | { status: 'miss' }
  | { status: 'discarded'; reason: 'schema' | 'fingerprint' | 'key' | 'corrupt' }

export interface CatalogCacheOptions {
  now?: () => number
  chunking?: ChunkingOptions
}

/** Chunks written per transaction while staging. */
const PUT_BATCH = 8
const EPG_CHANNELS_PER_CHUNK = 500

/**
 * The on-disk catalog: generations staged as chunks and published by
 * switching a small manifest per (source, type), in one transaction. See
 * `CacheManifest` for the invariants. Runs in the worker.
 */
export class CatalogCache {
  private cipher: CacheCipher | null = null
  /** Source id -> revision at which it was removed; older writes for it are dropped. */
  private readonly removed = new Map<string, number>()
  private readonly now: () => number
  private readonly chunking: ChunkingOptions
  /** Chunk keys of generations being written (refcounted): garbage collection leaves them alone. */
  private readonly staging = new Map<string, number>()
  /** Running reads per source; while any runs, the source's old chunks are not deleted. */
  private readonly readers = new Map<string, number>()
  private readonly deferred = new Map<string, Set<string>>()

  constructor(
    private readonly backend: CacheBackend,
    options: CatalogCacheOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.chunking = options.chunking ?? DEFAULT_CHUNKING
  }

  setCipher(cipher: CacheCipher | null): void {
    this.cipher = cipher
  }

  get keyId(): string | null {
    return this.cipher?.keyId ?? null
  }

  async fingerprint(identity: SourceIdentity): Promise<string | null> {
    if (identity.kind === 'xtream') {
      const url = identity.url.trim().replace(/\/+$/, '').toLowerCase()
      return `x${hash53(`${url}\n${identity.username}`).toString(36)}`
    }
    // The URL is a secret, and a plain hash of it could be brute-forced: keyed.
    if (!this.cipher) return null
    return `m${await this.cipher.name(identity.kind === 'm3u_url' ? `url\n${identity.url}` : `file\n${identity.path}`)}`
  }

  private stage(keys: readonly string[]): void {
    for (const key of keys) this.staging.set(key, (this.staging.get(key) ?? 0) + 1)
  }

  private unstage(keys: readonly string[]): void {
    for (const key of keys) {
      const count = (this.staging.get(key) ?? 1) - 1
      if (count <= 0) this.staging.delete(key)
      else this.staging.set(key, count)
    }
  }

  /** A read of the source's chunks starts: its superseded chunks stay until `endRead`. */
  beginRead(sourceId: string): void {
    this.readers.set(sourceId, (this.readers.get(sourceId) ?? 0) + 1)
  }

  async endRead(sourceId: string): Promise<void> {
    const count = (this.readers.get(sourceId) ?? 1) - 1
    if (count > 0) {
      this.readers.set(sourceId, count)
      return
    }
    this.readers.delete(sourceId)
    const keys = this.deferred.get(sourceId)
    this.deferred.delete(sourceId)
    if (keys) await this.deleteUnreferenced([...keys])
  }

  /** Deletes superseded chunks now, or once the source's running reads are done. */
  private async retire(sourceId: string, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    if ((this.readers.get(sourceId) ?? 0) > 0) {
      const pending = this.deferred.get(sourceId) ?? new Set<string>()
      for (const key of keys) pending.add(key)
      this.deferred.set(sourceId, pending)
      return
    }
    await this.backend.deleteChunks(keys)
  }

  private isRemoved(sourceId: string, revision: number): boolean {
    const removedAt = this.removed.get(sourceId)
    return removedAt !== undefined && revision <= removedAt
  }

  async write(request: CacheWriteRequest): Promise<CacheWriteReport> {
    const report: CacheWriteReport = { published: false, recordsTotal: 0, chunksTotal: 0, chunksWritten: 0, recordsWritten: 0 }
    const sealed = isSealedIdentity(request.identity)
    const cipher = this.cipher
    if (sealed && !cipher) return { ...report, skipped: 'no-key' }
    if (this.isRemoved(request.sourceId, request.sourceRevision)) return { ...report, skipped: 'removed' }
    const fingerprint = await this.fingerprint(request.identity)
    if (!fingerprint) return { ...report, skipped: 'no-key' }

    const written: string[] = []
    const staged: string[] = []
    const manifests: CacheManifest[] = []
    const previous = new Map<string, CacheManifest>()
    const extra = request.extra !== undefined && cipher && sealed ? await cipher.seal(request.extra) : null

    try {
      for (const write of request.partitions) {
        const key = manifestKey(request.sourceId, write.partition)
        const old = await this.backend.getManifest(key)
        if (old) previous.set(key, old)

        const planned = planChunks(write.items, this.chunking)
        const names = await Promise.all(
          planned.map((chunk) => (sealed ? cipher!.name(`${write.partition}\n${chunk.contentId}`) : Promise.resolve(chunk.contentId)))
        )
        const keys = names.map((name) => chunkKey(request.sourceId, write.partition, name))
        this.stage(keys)
        staged.push(...keys)
        // Unchanged chunks are already stored under the same key (same content,
        // same key, same encryption key): only the others are written.
        const existing = await this.backend.existingChunks(keys)
        const missing: CacheChunk[] = []
        for (const [i, plan] of planned.entries()) {
          const chunkKeyOfPlan = itemAt(keys, i)
          if (existing.has(chunkKeyOfPlan) || missing.some((chunk) => chunk.key === chunkKeyOfPlan)) continue
          const records = plan.records
          missing.push(
            sealed
              ? { key: chunkKeyOfPlan, sourceId: request.sourceId, sealed: await cipher!.seal({ items: records }) }
              : { key: chunkKeyOfPlan, sourceId: request.sourceId, items: records }
          )
          report.recordsWritten += records.length
        }
        report.recordsTotal += write.items.length
        report.chunksTotal += planned.length
        report.chunksWritten += missing.length

        let categoriesChunk: string | null = null
        if (write.categories) {
          const payload = { categories: write.categories }
          const contentId = `c${hash53(JSON.stringify(write.categories)).toString(36)}-${write.categories.length}`
          const name = sealed ? await cipher!.name(`${write.partition}\n${contentId}`) : contentId
          categoriesChunk = chunkKey(request.sourceId, write.partition, name)
          this.stage([categoriesChunk])
          staged.push(categoriesChunk)
          if (!(await this.backend.existingChunks([categoriesChunk])).has(categoriesChunk)) {
            missing.push(
              sealed
                ? { key: categoriesChunk, sourceId: request.sourceId, sealed: await cipher!.seal(payload) }
                : { key: categoriesChunk, sourceId: request.sourceId, categories: [...write.categories] }
            )
          }
        }

        for (const batch of slices(missing, PUT_BATCH)) {
          if (request.shouldPublish && !request.shouldPublish()) throw new WriteStopped('cancelled')
          if (this.isRemoved(request.sourceId, request.sourceRevision)) throw new WriteStopped('removed')
          await this.backend.putChunks(batch)
          for (const chunk of batch) written.push(chunk.key)
        }

        manifests.push({
          key,
          schema: CACHE_SCHEMA_VERSION,
          sourceId: request.sourceId,
          partition: write.partition,
          generation: (old?.generation ?? 0) + 1,
          complete: true,
          fetchedAt: request.fetchedAt,
          writtenAt: this.now(),
          fingerprint,
          sourceRevision: request.sourceRevision,
          itemCount: write.items.length,
          categoryCount: write.categories?.length ?? 0,
          chunks: keys,
          categoriesChunk,
          keyId: sealed ? cipher!.keyId : null,
          extra
        })
      }

      // The manifest switch: the only step that makes the new generation visible.
      if (request.shouldPublish && !request.shouldPublish()) throw new WriteStopped('cancelled')
      if (this.isRemoved(request.sourceId, request.sourceRevision)) throw new WriteStopped('removed')
      await this.backend.publish(manifests, [])
    } catch (error) {
      // Nothing points at what this attempt wrote: take it back. Whatever a
      // crash leaves behind is collected by `collectGarbage`.
      this.unstage(staged)
      await this.deleteUnreferenced(written).catch(() => undefined)
      if (error instanceof WriteStopped) return { ...report, skipped: error.reason }
      if (error instanceof Error && error.name === 'CacheQuotaError') return { ...report, skipped: 'quota' }
      throw error
    }
    this.unstage(staged)
    report.published = true

    // The previous generation is deleted only now that the new one is visible
    // (and, if a read of the old one is running, once that read is done).
    const stillUsed = new Set(manifests.flatMap((manifest) => [...manifest.chunks, manifest.categoriesChunk ?? '']))
    const stale = [...previous.values()]
      .flatMap((manifest) => [...manifest.chunks, manifest.categoriesChunk ?? ''])
      .filter((key) => key && !stillUsed.has(key))
    await this.retire(request.sourceId, [...new Set(stale)])
    return report
  }

  /** Chunks among `keys` that no manifest lists, deleted. */
  private async deleteUnreferenced(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    const referenced = new Set<string>()
    for (const manifest of await this.backend.listManifests()) {
      for (const key of manifest.chunks) referenced.add(key)
      if (manifest.categoriesChunk) referenced.add(manifest.categoriesChunk)
    }
    await this.backend.deleteChunks(keys.filter((key) => !referenced.has(key)))
  }

  /**
   * The published partitions of a source, validated. A manifest of another
   * schema, another source configuration or another key, or one whose chunks
   * are missing, discards the source's cache (it is refetched).
   */
  async read(sourceId: string, identity: SourceIdentity, partitions: readonly CatalogType[]): Promise<CacheReadResult> {
    const manifests: CachedPartition[] = []
    for (const partition of partitions) {
      const manifest = await this.backend.getManifest(manifestKey(sourceId, partition))
      if (manifest) manifests.push({ partition, manifest })
    }
    if (manifests.length === 0) return { status: 'miss' }

    const sealed = isSealedIdentity(identity)
    const fingerprint = await this.fingerprint(identity)
    let reason: 'schema' | 'fingerprint' | 'key' | 'corrupt' | null = null
    for (const { manifest } of manifests) {
      if (manifest.schema !== CACHE_SCHEMA_VERSION || manifest.complete !== true) reason = 'schema'
      else if (sealed && (!this.cipher || manifest.keyId !== this.cipher.keyId)) reason = 'key'
      else if (!fingerprint || manifest.fingerprint !== fingerprint) reason = 'fingerprint'
      if (reason) break
    }
    if (!reason) {
      const keys = manifests.flatMap(({ manifest }) => [...manifest.chunks, ...(manifest.categoriesChunk ? [manifest.categoriesChunk] : [])])
      const existing = await this.backend.existingChunks(keys)
      if (existing.size !== new Set(keys).size) reason = 'corrupt'
    }
    if (reason) {
      await this.dropPartitions(sourceId, CATALOG_PARTITIONS)
      return { status: 'discarded', reason }
    }

    let extra: unknown = null
    const sealedExtra = manifests.find(({ manifest }) => manifest.extra)?.manifest.extra ?? null
    if (sealedExtra && this.cipher) extra = await this.openOrNull(sealedExtra)
    return { status: 'hit', partitions: manifests, extra }
  }

  private async openOrNull(blob: SealedBlob): Promise<unknown> {
    try {
      return await this.cipher!.open(blob)
    } catch {
      return null
    }
  }

  /**
   * The items of a published partition, a few chunks at a time, in order.
   * Throws if a chunk is gone or cannot be decrypted (the caller drops the
   * source's cache and refetches).
   */
  async *readItems(manifest: CacheManifest, chunksPerStep = 4): AsyncGenerator<CatalogItem[]> {
    for (const keys of slices(manifest.chunks, chunksPerStep)) {
      const chunks = await this.backend.getChunks(keys)
      for (const chunk of chunks) {
        if (!chunk) throw new Error('Önbellek parçası eksik')
        yield chunk.sealed ? (await this.cipher!.open<{ items: CatalogItem[] }>(chunk.sealed)).items : (chunk.items ?? [])
      }
    }
  }

  async readCategories(manifest: CacheManifest): Promise<CatalogCategory[] | null> {
    if (!manifest.categoriesChunk) return null
    const [chunk] = await this.backend.getChunks([manifest.categoriesChunk])
    if (!chunk) throw new Error('Önbellek parçası eksik')
    return chunk.sealed ? (await this.cipher!.open<{ categories: CatalogCategory[] }>(chunk.sealed)).categories : (chunk.categories ?? [])
  }

  private async dropPartitions(sourceId: string, partitions: readonly CachePartition[]): Promise<void> {
    const keys = partitions.map((partition) => manifestKey(sourceId, partition))
    const manifests = (await Promise.all(keys.map((key) => this.backend.getManifest(key)))).filter(
      (manifest): manifest is CacheManifest => !!manifest
    )
    if (manifests.length === 0) return
    await this.backend.publish([], manifests.map((manifest) => manifest.key))
    await this.backend.deleteChunks(manifests.flatMap((manifest) => [...manifest.chunks, ...(manifest.categoriesChunk ? [manifest.categoriesChunk] : [])]))
  }

  /** Drops the catalog partitions of a source (its EPG stays), e.g. after a failed read. */
  async dropCatalog(sourceId: string): Promise<void> {
    await this.dropPartitions(sourceId, CATALOG_PARTITIONS)
  }

  /**
   * After a read failed: drops the partitions whose published generation is
   * still the one that was read; one that a newer write replaced meanwhile
   * is left alone.
   */
  async dropIfUnchanged(sourceId: string, read: readonly CachedPartition[]): Promise<void> {
    const stale: CachePartition[] = []
    for (const { partition, manifest } of read) {
      const current = await this.backend.getManifest(manifestKey(sourceId, partition))
      if (current && current.generation === manifest.generation && current.writtenAt === manifest.writtenAt) stale.push(partition)
    }
    if (stale.length > 0) await this.dropPartitions(sourceId, stale)
  }

  /**
   * Removes everything of a source. Writes for it fetched at `revision` or
   * before that finish later are dropped, so a removed source never comes
   * back on disk.
   */
  async dropSource(sourceId: string, revision: number): Promise<void> {
    this.removed.set(sourceId, Math.max(revision, this.removed.get(sourceId) ?? 0))
    const prefix = sourcePrefix(sourceId)
    const manifests = (await this.backend.listManifests()).filter((manifest) => manifest.sourceId === sourceId)
    if (manifests.length > 0) await this.backend.publish([], manifests.map((manifest) => manifest.key))
    const keys = (await this.backend.listChunkKeys()).filter((key) => key.startsWith(prefix))
    await this.backend.deleteChunks(keys)
  }

  /**
   * Keeps only the given sources: manifests of others and chunks no manifest
   * lists (left by a crash or a failed write) are deleted. With no source at
   * all, the database is emptied.
   */
  async collectGarbage(keepSourceIds: readonly string[]): Promise<{ manifests: number; chunks: number }> {
    if (keepSourceIds.length === 0) {
      const counts = { manifests: (await this.backend.listManifests()).length, chunks: (await this.backend.listChunkKeys()).length }
      await this.backend.clear()
      return counts
    }
    const keep = new Set(keepSourceIds)
    const manifests = await this.backend.listManifests()
    const doomed = manifests.filter((manifest) => !keep.has(manifest.sourceId))
    if (doomed.length > 0) await this.backend.publish([], doomed.map((manifest) => manifest.key))
    const referenced = new Set<string>()
    for (const manifest of manifests) {
      if (!keep.has(manifest.sourceId)) continue
      for (const key of manifest.chunks) referenced.add(key)
      if (manifest.categoriesChunk) referenced.add(manifest.categoriesChunk)
    }
    const busy = new Set<string>()
    for (const keys of this.deferred.values()) for (const key of keys) busy.add(key)
    const orphans = (await this.backend.listChunkKeys()).filter((key) => !referenced.has(key) && !this.staging.has(key) && !busy.has(key))
    await this.backend.deleteChunks(orphans)
    return { manifests: doomed.length, chunks: orphans.length }
  }

  async stats(): Promise<{ manifests: number; chunks: number }> {
    return { manifests: (await this.backend.listManifests()).length, chunks: (await this.backend.listChunkKeys()).length }
  }

  // ------------------------------------------------------------------ EPG ---

  /** Stores a windowed EPG as one generation; replaces the previous one. */
  async writeEpg(request: {
    sourceId: string
    identity: SourceIdentity
    sourceRevision: number
    fetchedAt: number
    channels: readonly unknown[]
    truncated: string | null
    shouldPublish?: () => boolean
  }): Promise<boolean> {
    if (this.isRemoved(request.sourceId, request.sourceRevision)) return false
    const fingerprint = await this.fingerprint(request.identity)
    if (!fingerprint) return false
    const key = manifestKey(request.sourceId, 'epg')
    const old = await this.backend.getManifest(key)
    const generation = (old?.generation ?? 0) + 1
    const chunks = slices(request.channels, EPG_CHANNELS_PER_CHUNK).map((epg, index) => ({
      key: chunkKey(request.sourceId, 'epg', `g${generation}-${index}`),
      sourceId: request.sourceId,
      epg
    }))
    const written: string[] = []
    try {
      for (const batch of slices(chunks, PUT_BATCH)) {
        if ((request.shouldPublish && !request.shouldPublish()) || this.isRemoved(request.sourceId, request.sourceRevision)) {
          throw new WriteStopped('cancelled')
        }
        await this.backend.putChunks(batch)
        for (const chunk of batch) written.push(chunk.key)
      }
      if ((request.shouldPublish && !request.shouldPublish()) || this.isRemoved(request.sourceId, request.sourceRevision)) {
        throw new WriteStopped('cancelled')
      }
      await this.backend.publish(
        [
          {
            key,
            schema: CACHE_SCHEMA_VERSION,
            sourceId: request.sourceId,
            partition: 'epg',
            generation,
            complete: true,
            fetchedAt: request.fetchedAt,
            writtenAt: this.now(),
            fingerprint,
            sourceRevision: request.sourceRevision,
            itemCount: request.channels.length,
            categoryCount: 0,
            chunks: chunks.map((chunk) => chunk.key),
            categoriesChunk: null,
            keyId: null,
            extra: null,
            epgTruncated: request.truncated
          }
        ],
        []
      )
    } catch (error) {
      await this.deleteUnreferenced(written).catch(() => undefined)
      if (error instanceof WriteStopped || (error instanceof Error && error.name === 'CacheQuotaError')) return false
      throw error
    }
    if (old) await this.retire(request.sourceId, old.chunks)
    return true
  }

  async readEpg(sourceId: string, identity: SourceIdentity): Promise<{ manifest: CacheManifest; channels: unknown[] } | null> {
    const manifest = await this.backend.getManifest(manifestKey(sourceId, 'epg'))
    if (!manifest) return null
    const fingerprint = await this.fingerprint(identity)
    if (manifest.schema !== CACHE_SCHEMA_VERSION || manifest.fingerprint !== fingerprint) {
      await this.dropPartitions(sourceId, ['epg'])
      return null
    }
    const chunks = await this.backend.getChunks(manifest.chunks)
    if (chunks.some((chunk) => !chunk)) {
      await this.dropPartitions(sourceId, ['epg'])
      return null
    }
    return { manifest, channels: chunks.flatMap((chunk) => (chunk!.epg as unknown[]) ?? []) }
  }
}

const CATALOG_PARTITIONS: readonly CachePartition[] = ['live', 'vod', 'series']

class WriteStopped extends Error {
  constructor(readonly reason: 'removed' | 'cancelled') {
    super(reason)
  }
}
