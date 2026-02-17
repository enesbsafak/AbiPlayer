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

export interface Channel {
  id: string
  name: string
  logo?: string
  streamUrl: string
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
  // VOD extra
  rating?: string
  plot?: string
  cast?: string
  director?: string
  genre?: string
  releaseDate?: string
  duration?: string
  year?: string
  coverUrl?: string
  backdropUrl?: string
  // Series extra
  seriesId?: number
  seasonCount?: number
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
