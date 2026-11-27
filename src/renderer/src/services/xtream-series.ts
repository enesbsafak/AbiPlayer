import type { Channel, EpisodeInfo, SeasonInfo, SeriesDetail } from '@/types/playlist'
import type { EpisodePlaybackRequest, PlaybackRequest, QueuedEpisode } from '@/types/player'
import { episodeTarget, mediaKey } from '../../../shared/playback'
import { strings } from '@/strings'

const text = strings.catalog.detail

/*
 * An Xtream series as its `get_series_info` answer describes it. The series
 * page shows it; the player reads the same thing to know which episode comes
 * next, so both go through here.
 */

type SeasonRaw = { season_number?: number; name?: string; episode_count?: number; cover?: string }
type EpisodeRaw = {
  id?: string | number
  episode_num?: number
  title?: string
  container_extension?: string
  season?: number
  info?: {
    plot?: string
    duration?: string
    duration_secs?: number
    rating?: number
    movie_image?: string
  }
}

function normalizeSeasons(raw: unknown): SeasonRaw[] {
  // Some Xtream servers return `seasons` as an object keyed by season number,
  // others as an array, others omit it entirely. Normalize to an array.
  if (Array.isArray(raw)) return raw as SeasonRaw[]
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, SeasonRaw>)
  return []
}

function normalizeEpisodeMap(raw: unknown): Record<string, EpisodeRaw[]> {
  // PHP-backed servers return `episodes: []` (empty array) instead of `{}`
  // when the series has no episodes. Also some return episode lists as
  // objects keyed by episode_num. Normalize each season to an array.
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, EpisodeRaw[]> = {}
  const entries = Array.isArray(raw)
    ? raw.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(raw as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      result[key] = value as EpisodeRaw[]
    } else if (value && typeof value === 'object') {
      result[key] = Object.values(value as Record<string, EpisodeRaw>)
    }
  }
  return result
}

function normalizeInfoObject(raw: unknown): Record<string, unknown> {
  // `info.info` is sometimes serialized as `[]` (empty array) by PHP when the
  // upstream record has no metadata. Treat anything non-object-like as empty.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export function parseEpisodeId(id: unknown): number | null {
  if (typeof id === 'number' && Number.isFinite(id)) return id
  if (typeof id === 'string') {
    const n = parseInt(id, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

export interface XtreamSeriesRecord {
  detail: SeriesDetail
  /** The answer's own `info` object (ids of other services live there). */
  rawInfo: Record<string, unknown>
}

/**
 * The series of one `get_series_info` answer. `buildEpisodeUrl` gives the URL
 * kept with each episode (used only when none can be derived at play time).
 */
export function seriesDetailFromInfo(
  info: unknown,
  seriesId: number,
  buildEpisodeUrl: (episodeId: number, containerExtension: string) => string
): XtreamSeriesRecord {
  const rawInfo = normalizeInfoObject((info as { info?: unknown }).info)
  const rawSeasons = normalizeSeasons((info as { seasons?: unknown }).seasons)
  const rawEpisodes = normalizeEpisodeMap((info as { episodes?: unknown }).episodes)

  const seasons: SeasonInfo[] = rawSeasons.flatMap((season) => {
    if (typeof season.season_number !== 'number') return []
    return [{
      seasonNumber: season.season_number,
      name: season.name || '',
      episodeCount: season.episode_count || 0,
      cover: season.cover || ''
    }]
  })

  const episodes: Record<number, EpisodeInfo[]> = {}
  for (const [seasonNum, eps] of Object.entries(rawEpisodes)) {
    const seasonKey = parseInt(seasonNum, 10)
    if (!Number.isFinite(seasonKey)) continue
    episodes[seasonKey] = eps
      .map((ep) => {
        const streamId = parseEpisodeId(ep.id)
        if (streamId === null) return null
        return {
          id: typeof ep.id === 'string' ? ep.id : String(ep.id ?? streamId),
          episodeNum: ep.episode_num ?? 0,
          title: ep.title || '',
          containerExtension: ep.container_extension || 'mp4',
          plot: ep.info?.plot || '',
          duration: ep.info?.duration || '',
          durationSecs: ep.info?.duration_secs || 0,
          rating: ep.info?.rating || 0,
          season: ep.season ?? seasonKey,
          coverUrl: ep.info?.movie_image || '',
          streamUrl: buildEpisodeUrl(streamId, ep.container_extension || 'mp4')
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
  }

  // If seasons array is empty but episodes were returned, synthesize
  // seasons from the episode map so the UI still has something to show.
  const seasonsFromEpisodes =
    seasons.length === 0
      ? Object.keys(episodes)
          .flatMap((key) => {
            const seasonNumber = parseInt(key, 10)
            return Number.isFinite(seasonNumber) ? [seasonNumber] : []
          })
          .sort((a, b) => a - b)
          .map((seasonNumber) => ({
            seasonNumber,
            name: text.season(seasonNumber),
            episodeCount: episodes[seasonNumber]?.length ?? 0,
            cover: ''
          }))
      : seasons

  const rawName = typeof rawInfo.name === 'string' ? rawInfo.name : ''
  const rawCover = typeof rawInfo.cover === 'string' ? rawInfo.cover : ''
  const rawPlot = typeof rawInfo.plot === 'string' ? rawInfo.plot : ''
  const rawCast = typeof rawInfo.cast === 'string' ? rawInfo.cast : ''
  const rawDirector = typeof rawInfo.director === 'string' ? rawInfo.director : ''
  const rawGenre = typeof rawInfo.genre === 'string' ? rawInfo.genre : ''
  const rawReleaseDate = typeof rawInfo.release_date === 'string' ? rawInfo.release_date : ''
  const rawRating =
    typeof rawInfo.rating === 'string'
      ? rawInfo.rating
      : typeof rawInfo.rating === 'number'
        ? String(rawInfo.rating)
        : ''
  const rawBackdrop = Array.isArray(rawInfo.backdrop_path)
    ? (rawInfo.backdrop_path as unknown[]).filter((x): x is string => typeof x === 'string')
    : []

  return {
    rawInfo,
    detail: {
      seriesId,
      name: rawName,
      cover: rawCover,
      plot: rawPlot,
      cast: rawCast,
      director: rawDirector,
      genre: rawGenre,
      releaseDate: rawReleaseDate,
      rating: rawRating,
      backdropPath: rawBackdrop,
      seasons: seasonsFromEpisodes,
      episodes
    }
  }
}

/** One episode as the player starts it, or null when it has no usable id. */
export function episodeRequestOf(
  sourceId: string,
  seriesId: number,
  seriesName: string,
  episode: EpisodeInfo
): EpisodePlaybackRequest | null {
  const episodeId = parseEpisodeId(episode.id)
  if (episodeId === null) return null
  return {
    sourceId,
    seriesId,
    season: episode.season,
    episodeNum: episode.episodeNum,
    episodeId,
    containerExtension: episode.containerExtension,
    title: text.episodeTitle(seriesName, episode.season, episode.episodeNum, episode.title),
    ...(episode.coverUrl ? { coverUrl: episode.coverUrl } : {}),
    fallbackStreamUrl: episode.streamUrl
  }
}

/** The episode as the player UI shows it. Its id is stable, not a timestamp. */
export function episodeDisplayChannel(request: EpisodePlaybackRequest): Channel {
  return {
    id: `${request.sourceId}_episode_${request.episodeId}`,
    name: request.title,
    streamUrl: request.fallbackStreamUrl ?? '',
    sourceId: request.sourceId,
    // The player treats an episode like a film (seekable, resumable).
    type: 'vod',
    ...(request.coverUrl ? { coverUrl: request.coverUrl } : {})
  }
}

/** What starts the episode: a real episode target and what the player shows for it. */
export function episodePlayback(request: EpisodePlaybackRequest): PlaybackRequest {
  return {
    target: episodeTarget({
      sourceId: request.sourceId,
      episodeId: request.episodeId,
      containerExtension: request.containerExtension,
      seriesId: request.seriesId,
      season: request.season,
      episode: request.episodeNum
    }),
    channel: episodeDisplayChannel(request)
  }
}

export function queuedEpisodeOf(request: EpisodePlaybackRequest): QueuedEpisode {
  const playback = episodePlayback(request)
  return { mediaKey: mediaKey(playback.target), title: request.title, request: playback }
}

/**
 * Every episode of the series in the order its page lists them: season by
 * season as the season pills stand, each season's episodes as its list shows
 * them. What "next" and "previous" mean while one of them plays.
 */
export function episodeQueueOf(sourceId: string, detail: SeriesDetail): QueuedEpisode[] {
  const listed = detail.seasons.map((season) => season.seasonNumber)
  // A season with episodes but no pill still plays on; it follows the listed ones.
  const unlisted = Object.keys(detail.episodes)
    .map(Number)
    .filter((season) => Number.isFinite(season) && !listed.includes(season))
    .sort((a, b) => a - b)
  const queue: QueuedEpisode[] = []
  const seen = new Set<number>()
  for (const season of [...listed, ...unlisted]) {
    for (const episode of detail.episodes[season] ?? []) {
      const request = episodeRequestOf(sourceId, detail.seriesId, detail.name, episode)
      if (!request || seen.has(request.episodeId)) continue
      seen.add(request.episodeId)
      queue.push(queuedEpisodeOf(request))
    }
  }
  return queue
}
