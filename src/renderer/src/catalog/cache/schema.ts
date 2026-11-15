import type { CatalogCategory, CatalogItem, CatalogType } from '../types'
import type { SealedBlob } from './cipher'

/**
 * Bumped whenever what a chunk or manifest holds changes meaning. A cache
 * written under another version is discarded, never migrated: it is only a
 * copy of what the provider sends anyway.
 */
export const CACHE_SCHEMA_VERSION = 1

export const CACHE_DB_NAME = 'abi-catalog-cache'

/** A cached partition: one content type of a source, or its windowed EPG. */
export type CachePartition = CatalogType | 'epg'

const SEP = '\u0001'

export function manifestKey(sourceId: string, partition: CachePartition): string {
  return `${sourceId}${SEP}${partition}`
}

/** Every chunk key of a source starts with this; a removed source's chunks are found by it. */
export function sourcePrefix(sourceId: string): string {
  return `${sourceId}${SEP}`
}

export function chunkKey(sourceId: string, partition: CachePartition, name: string): string {
  return `${sourceId}${SEP}${partition}${SEP}${name}`
}

/**
 * The small record that makes a generation visible. Publishing a generation
 * is one transaction that switches this record; the chunks it lists are all
 * written before that, and the previous generation's chunks are deleted only
 * after it. A crash or a failed write in between leaves the previous
 * manifest, which still lists only chunks that exist.
 */
export interface CacheManifest {
  key: string
  schema: number
  sourceId: string
  partition: CachePartition
  /** Increases with every published generation of the partition. */
  generation: number
  /** Always true for a published manifest: preview or partial lists are never cached. */
  complete: true
  /** When the provider sent the list (epoch ms). */
  fetchedAt: number
  writtenAt: number
  /**
   * Identifies the source configuration the data belongs to (server and
   * account, playlist, file). A manifest for another fingerprint is stale:
   * the source was edited, or its id reused.
   */
  fingerprint: string
  /** The in-memory source revision the data was fetched under (diagnostics). */
  sourceRevision: number
  itemCount: number
  categoryCount: number
  /** Ordered chunk keys; the items are their concatenation. */
  chunks: string[]
  /** Chunk holding the category list, if any. */
  categoriesChunk: string | null
  /** Set when the chunks are sealed: the key they were sealed with. */
  keyId: string | null
  /** Source-level extras, sealed with the chunks' key when `keyId` is set (M3U EPG URLs). */
  extra: SealedBlob | null
  /** EPG only: whether the parse stopped early, and why. */
  epgTruncated?: string | null
}

/** One stored chunk. Exactly one payload is set. */
export interface CacheChunk {
  key: string
  sourceId: string
  items?: CatalogItem[]
  categories?: CatalogCategory[]
  /** EPG payload: channels and their windowed programmes. */
  epg?: unknown
  /** A sealed payload (M3U): `{ items }` or `{ categories }` as JSON, encrypted. */
  sealed?: SealedBlob
}
