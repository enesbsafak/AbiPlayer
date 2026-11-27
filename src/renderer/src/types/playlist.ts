import type { StreamHttpHeaders } from '../../../shared/playback'

export type SourceType = 'xtream' | 'm3u_url' | 'm3u_file'

export interface PlaylistSource {
  id: string
  name: string
  type: SourceType
  url?: string
  username?: string
  password?: string
  filePath?: string
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
   * time from `streamId` / `seriesId` and the source.
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
  /** Request headers its M3U list asks for with this entry (user agent, referer, origin). */
  httpHeaders?: StreamHttpHeaders
}

export interface SeriesDetail {
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
  streamUrl: string
}
