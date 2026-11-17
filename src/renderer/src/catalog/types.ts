import type { Category, Channel } from '@/types/playlist'
import type { XtreamErrorKind } from '@/services/xtream-errors'

export type CatalogType = 'live' | 'vod' | 'series'

export const CATALOG_TYPES: readonly CatalogType[] = ['live', 'vod', 'series']

/**
 * One list record: what lists, cards, search and playback need, nothing more.
 *
 * - Xtream items carry no URL (`streamUrl` is ''): playback builds it at the
 *   edge from `streamId` / `seriesId` / `containerExtension` and the source's
 *   credentials. M3U entries keep their URL, which is their identity, and never
 *   carry a `streamId`.
 * - Detail text (plot, cast, director, ...) is not stored; detail views fetch it.
 * - `searchName` / `searchGroup` and `isAdult` are computed once at ingest.
 *
 * Records are plain data (structured-clone safe), so a worker can build them.
 */
export interface CatalogItem extends Channel {
  type: CatalogType
  /** `normalizeSearchText(name)`; filtering is a substring test on it. */
  searchName: string
  /** Normalized group / category name for entries that carry one (M3U). */
  searchGroup?: string
  /**
   * The item's own adult flag (provider flag or its name). Items in an adult
   * category are resolved by the view, because Xtream items only carry the
   * category id and categories may arrive after the items.
   */
  isAdult: boolean
  /** Xtream `added` (live, vod), unix seconds. */
  added?: number
  /** Xtream `last_modified` (series), unix seconds. */
  lastModified?: number
}

export interface CatalogCategory extends Category {
  type: CatalogType
  /** `isAdultLabel(name)`, computed once at ingest. */
  isAdult: boolean
}

/**
 * Identifies one sync (or one fetch) of one (source, type). Issued by
 * `beginGeneration`; a commit carrying a token whose source was removed or
 * refreshed since, or that a newer complete list overtook, is dropped.
 */
export interface GenerationToken {
  sourceId: string
  type: CatalogType
  /** The source's revision when the token was issued. */
  revision: number
  /** Increases with every token the store issues. */
  generation: number
}

export type CommitMode = 'replace' | 'partial'

/**
 * A generation for one (source, type). Plain data: a worker can post it as is.
 *
 * - `replace`: `items` is the complete list. It replaces the previous one, so
 *   items the provider dropped disappear, and marks the slice complete.
 * - `partial`: `items` are upserted (existing ids updated in place, new ones
 *   appended). Never marks the slice complete. `categoryId` says the batch is
 *   the whole content of that one category (fetched on demand).
 * - `categories`, when given, is the complete category list and replaces the
 *   previous one, in either mode.
 */
export interface CatalogCommit {
  token: GenerationToken
  mode: CommitMode
  items?: readonly CatalogItem[]
  categories?: readonly CatalogCategory[]
  categoryId?: string
  /** `replace` only: where the complete list comes from (see `CatalogStatus.fromCache`). */
  origin?: CatalogListOrigin
}

/** Where a complete list came from: the provider in this session, or the on-disk cache, and when it was fetched. */
export interface CatalogListOrigin {
  fromCache: boolean
  /** When the provider sent the list (epoch ms). */
  fetchedAt: number
}

/** What `commit` did. `stale`: the source was removed or refreshed; `superseded`: a newer list won. */
export type CommitResult = 'committed' | 'stale' | 'superseded'

export type CatalogSyncErrorKind = XtreamErrorKind | 'unknown'

/** A failed sync, as the pages need it to pick a banner. `message` is Turkish and safe to show. */
export interface CatalogSyncError {
  kind: CatalogSyncErrorKind
  message: string
  /** A retry may well succeed (network, timeout, 408/429/5xx). */
  retryable: boolean
  status?: number
  /** Host of the request that failed (lower case), when the failure came from a request. */
  host?: string
  /** A TMDB request failed (the built-in catalogue): `message` already names TMDB and what to do. */
  origin?: 'tmdb'
}

/** Small per-(source, type) status. Mirrored into the zustand store as `catalogStatus`. */
export interface CatalogStatus {
  sourceId: string
  type: CatalogType
  /** Bumped on every accepted change of the items or the categories. */
  version: number
  /** Number of items held. */
  count: number
  /** At least one batch of items (partial or complete) has been committed. */
  loaded: boolean
  /** The held items are a complete list. False after a refresh invalidated them. */
  complete: boolean
  /** A category list has been committed. */
  categoriesLoaded: boolean
  /** A full sync is running. */
  syncing: boolean
  /** The last sync failed; cleared when a sync starts or succeeds. */
  error: CatalogSyncError | null
  /**
   * The complete list held was read from the on-disk cache and has not been
   * replaced by the provider's list in this session yet. Absent means false.
   */
  fromCache?: boolean
  /** When the complete list held was fetched from the provider (epoch ms); absent or null before the first one. */
  fetchedAt?: number | null
}

/** The user's catalog preferences the view applies. */
export interface CatalogViewSettings {
  /** Categories the user hid: they and their items drop out of every list. */
  hiddenCategoryIds: ReadonlySet<string>
  /** Off: adult items and categories are hidden. On: they are listed last. */
  showAdultContent: boolean
}

/** Emitted for every changed (source, type). */
export interface CatalogChange {
  sourceId: string
  type: CatalogType
}

export type CatalogListener = (change: CatalogChange) => void

/** A whole source's complete lists, e.g. a parsed M3U playlist. Missing types become empty. */
export type SourceCatalogReplacement = Partial<
  Record<CatalogType, { items: readonly CatalogItem[]; categories: readonly CatalogCategory[] }>
>
