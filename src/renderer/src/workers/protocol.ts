import type { CatalogCategory, CatalogItem, CatalogType } from '@/catalog/types'
import type { CacheWriteReport, SourceIdentity } from '@/catalog/cache/catalog-cache'
import type { EPGChannel, EPGProgram } from '@/types/epg'
import type { XtreamCredentials } from '@/types/xtream'

/*
 * Messages between the main thread and the catalog worker. Every message
 * carries the protocol version; a job has an id, reports progress, may be
 * cancelled, and ends with exactly one `done` or `error`.
 *
 * Records cross in bounded batches (`items`), never as one giant array; the
 * main thread collects a list's batches in a staged replace and swaps it in
 * on `list-end`. Errors are plain data that keep the Xtream error kinds.
 */

export const CATALOG_WORKER_PROTOCOL = 1

/** Records per `items` message: big enough to amortise a message, small enough to deserialize well under a frame. */
export const ITEMS_PER_MESSAGE = 4000

/** Where a job's lists come from, for the status they get. */
export type ListOrigin = 'network' | 'cache'

export interface ListMeta {
  /** When the provider sent the lists (epoch ms); for cached lists the original time. */
  fetchedAt: number
  origin: ListOrigin
}

export type WorkerJob =
  /** Download one whole Xtream list, convert it to records, cache it. */
  | {
      kind: 'xtream-list'
      sourceId: string
      type: CatalogType
      creds: XtreamCredentials
      revision: number
      /** Known category list to cache with it; fetched when missing. */
      categories: CatalogCategory[] | null
      cache: boolean
    }
  /** Download and parse an M3U playlist (streamed: no whole-text string), cache it sealed. */
  | { kind: 'm3u-url'; sourceId: string; url: string; revision: number; cache: boolean }
  /** Parse a local playlist the main process read, cache it sealed. */
  | { kind: 'm3u-text'; sourceId: string; text: string; path: string; revision: number; cache: boolean }
  /** The cached lists of a source, as `items` batches and a `list-end`. */
  | { kind: 'cache-read'; sourceId: string; identity: SourceIdentity; types: CatalogType[]; revision: number }
  /** Lists the main thread holds (made elsewhere) written to the cache. Items follow as `put-items` messages. */
  | {
      kind: 'cache-write'
      sourceId: string
      identity: SourceIdentity
      revision: number
      fetchedAt: number
      partitions: Array<{ type: CatalogType; categories: CatalogCategory[] | null; count: number }>
      extra: unknown
    }
  /** Forget a removed source on disk; later writes from older revisions are dropped. */
  | { kind: 'cache-drop'; sourceId: string; revision: number }
  /** Keep only these sources on disk (empty: delete everything). */
  | { kind: 'cache-retain'; sourceIds: string[] }
  /** Download and parse an XMLTV guide, streamed, keeping only the time window. */
  | {
      kind: 'epg'
      sourceId: string
      url: string
      identity: SourceIdentity
      revision: number
      windowStart: number
      windowEnd: number
      /** Normalized channel keys to keep; null keeps every channel (up to the limit). */
      channelKeys: string[] | null
      cache: boolean
    }
  | { kind: 'epg-cache-read'; sourceId: string; identity: SourceIdentity; windowStart: number; windowEnd: number }
  /** Sizes, for measurements and tests. */
  | { kind: 'cache-stats' }

export type WorkerJobKind = WorkerJob['kind']

export interface EpgResultMeta {
  fetchedAt: number
  /** Why the guide is incomplete, if it is: 'cut-off' (the download ended mid-document), 'limit' (too many channels or programmes). */
  truncated: string | null
  channels: number
  programmes: number
  origin: ListOrigin
}

export type JobResult =
  | { kind: 'lists'; meta: ListMeta; counts: Partial<Record<CatalogType, number>>; epgUrls: string[]; cache: CacheWriteReport | null }
  | { kind: 'cache-miss'; reason: 'empty' | 'schema' | 'fingerprint' | 'key' | 'corrupt' | 'no-key' | 'unavailable' }
  | { kind: 'cache-written'; report: CacheWriteReport }
  | { kind: 'epg'; meta: EpgResultMeta }
  | { kind: 'ok' }
  | { kind: 'stats'; manifests: number; chunks: number; available: boolean }

/** An error as data. `kind` keeps the Xtream (and playlist) error kinds across the boundary. */
export interface WireError {
  name: string
  message: string
  kind?: string
  status?: number
  host?: string
}

export type MainToWorker =
  | { v: number; type: 'job'; id: number; job: WorkerJob }
  | { v: number; type: 'cancel'; id: number }
  /** Records for a running `cache-write` job; `last` ends the partition. */
  | { v: number; type: 'put-items'; id: number; partition: CatalogType; items: CatalogItem[]; last: boolean }
  /** The M3U cache key (raw bytes, in memory only), or null when there is none. */
  | { v: number; type: 'key'; key: ArrayBuffer | null }

export type WorkerToMain =
  | { v: number; type: 'progress'; id: number; phase: string; loaded?: number }
  | { v: number; type: 'items'; id: number; partition: CatalogType; items: CatalogItem[] }
  | { v: number; type: 'categories'; id: number; partition: CatalogType; categories: CatalogCategory[] }
  /** Every batch of the job's lists was sent: the main thread may swap them in. */
  | { v: number; type: 'list-end'; id: number; partitions: CatalogType[]; meta: ListMeta; epgUrls: string[] }
  | { v: number; type: 'epg-batch'; id: number; channels: EPGChannel[]; programmes: Array<[string, EPGProgram[]]> }
  | { v: number; type: 'done'; id: number; result: JobResult }
  | { v: number; type: 'error'; id: number; error: WireError }
  /** The worker could not understand a message (wrong protocol version). */
  | { v: number; type: 'protocol-error'; message: string }

/** A message without its version field (added when it is sent). */
export type Unversioned<T> = T extends unknown ? Omit<T, 'v'> : never

export function toWireError(error: unknown): WireError {
  if (error && typeof error === 'object') {
    const like = error as { name?: unknown; message?: unknown; kind?: unknown; status?: unknown; host?: unknown }
    const wire: WireError = {
      name: typeof like.name === 'string' ? like.name : 'Error',
      message: typeof like.message === 'string' ? like.message : String(error)
    }
    if (typeof like.kind === 'string') wire.kind = like.kind
    if (typeof like.status === 'number') wire.status = like.status
    if (typeof like.host === 'string') wire.host = like.host
    // A DOMException abort has no kind of its own.
    if (!wire.kind && wire.name === 'AbortError') wire.kind = 'aborted'
    return wire
  }
  return { name: 'Error', message: String(error) }
}
