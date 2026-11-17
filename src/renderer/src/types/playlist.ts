import type { AddonManifestSummary } from './addon'

export type SourceType = 'xtream' | 'm3u_url' | 'm3u_file' | 'addon'

/** The catalogues the app builds itself (see `PlaylistSource.builtin`). */
export type BuiltinCatalogId = 'tmdb'

export interface PlaylistSource {
  id: string
  name: string
  type: SourceType
  /**
   * Xtream server URL, M3U playlist URL, or an add-on's base address. Only the
   * Xtream server URL is persisted; the other two are secrets kept in the
   * secure store and put here in memory.
   */
  url?: string
  username?: string
  password?: string
  filePath?: string
  /** `addon` sources: the persisted summary of the add-on's manifest. */
  addon?: AddonManifestSummary
  /**
   * `addon` sources the app provides itself instead of an add-on at an
   * address: `tmdb`, the film and series catalogue built from TMDB with the
   * user's own TMDB key. No address, no secret of its own (addons/builtin.ts).
   */
  builtin?: BuiltinCatalogId
  addedAt: number
  lastRefresh?: number
}

export interface Category {
  id: string
  name: string
  sourceId: string
  type: 'live' | 'vod' | 'series'
  parentId?: string
}

/**
 * A catalog item as lists, cards, search and playback see it. Catalog records
 * (`CatalogItem` in `@/catalog`) extend it. Detail text (plot, cast, director,
 * genre, ...) is not part of it: detail views fetch that themselves.
 */
export interface Channel {
  id: string
  name: string
  logo?: string
  /**
   * The M3U entry URL, which is that entry's identity. Empty for Xtream
   * items: their URL holds the account credentials and is built at playback
   * time from `streamId` / `seriesId` and the source. Empty for add-on items:
   * their stream is chosen among candidates when played.
   */
  streamUrl: string
  /** Xtream live and film id. Never set on M3U entries. */
  streamId?: number
  sourceId: string
  categoryId?: string
  categoryName?: string
  epgChannelId?: string
  group?: string
  type: 'live' | 'vod' | 'series'
  isAdult?: boolean
  tvArchive?: boolean
  tvArchiveDuration?: number
  containerExtension?: string
  rating?: string
  year?: string
  coverUrl?: string
  /** Xtream series id. */
  seriesId?: number
  /** Add-on catalogue items: the add-on's meta id (also the stream id of a film). */
  addonMetaId?: string
  /**
   * A film's stream id when it is not its meta id: the IMDb id the built-in
   * TMDB catalogue looks up when the film's detail opens. Never persisted
   * with the catalogue; the detail and the player's channel carry it.
   */
  addonVideoId?: string
}

export interface SeriesDetail {
  /** Xtream series id; 0 for an add-on series (its meta id identifies it). */
  seriesId: number
  name: string
  cover: string
  plot: string
  cast: string
  director: string
  genre: string
  releaseDate: string
  rating: string
  backdropPath: string[]
  seasons: SeasonInfo[]
  episodes: Record<number, EpisodeInfo[]>
}

export interface SeasonInfo {
  seasonNumber: number
  name: string
  episodeCount: number
  cover: string
}

export interface EpisodeInfo {
  /** Xtream episode id, or an add-on episode's video id. */
  id: string
  episodeNum: number
  title: string
  containerExtension: string
  plot: string
  duration: string
  durationSecs: number
  rating: number
  season: number
  coverUrl: string
  /** Empty for add-on episodes: their stream is chosen when played. */
  streamUrl: string
  /** When it first aired, as a date to show; only the built-in TMDB catalogue gives it. */
  airDate?: string
}
