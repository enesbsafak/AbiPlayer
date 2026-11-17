import type { Channel, EpisodeInfo, PlaylistSource, SeasonInfo, SeriesDetail } from '@/types/playlist'
import { strings } from '@/strings'
import { addonTarget, type AddonContentType, type AddonPlaybackTarget } from '../../../shared/playback'
import type { AddonFetchOptions, AddonMeta, AddonVideo } from './client'
import { remoteCatalogProvider, type AddonCatalogProvider } from './provider'

/*
 * An add-on's meta mapped onto the detail shapes the film and series pages
 * already use. Detail text comes from the catalogue add-on the item was
 * listed by; nothing here is keyed on a particular add-on.
 */

/** What the film detail shows: the same fields as the Xtream film detail, plus a backdrop. */
export interface AddonVodInfo {
  name: string
  plot: string
  cast: string
  director: string
  genre: string
  releaseDate: string
  duration: string
  rating: string
  year: string
  cover: string
  backdrop: string
}

const LIST_SEPARATOR = ', '

export function addonMetaToVodInfo(meta: AddonMeta): AddonVodInfo {
  return {
    name: meta.name,
    plot: meta.description ?? '',
    cast: meta.cast.join(LIST_SEPARATOR),
    director: meta.director.join(LIST_SEPARATOR),
    genre: meta.genres.join(LIST_SEPARATOR),
    releaseDate: meta.releaseInfo ?? meta.year ?? '',
    duration: meta.runtime ?? '',
    rating: meta.rating ?? '',
    year: meta.year ?? '',
    cover: meta.poster ?? '',
    backdrop: meta.background ?? ''
  }
}

/** Specials (season 0) go after every numbered season. */
function seasonOrder(season: number): number {
  return season === 0 ? Number.MAX_SAFE_INTEGER : season
}

function releasedAt(video: AddonVideo): number {
  const time = video.released ? Date.parse(video.released) : Number.NaN
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
}

/**
 * The videos of one season as its episodes: by number, then release date,
 * then the add-on's order. An episode without a number gets its place in the
 * season. `EpisodeInfo.id` is the video id (what the stream request takes);
 * `streamUrl` stays empty.
 */
export function addonVideosToEpisodes(videos: readonly AddonVideo[], seasonNumber: number): EpisodeInfo[] {
  const entries = videos
    .map((video, index) => ({ video, index }))
    .sort((a, b) => {
      const numberA = a.video.episode
      const numberB = b.video.episode
      if (numberA !== null && numberB !== null && numberA !== numberB) return numberA - numberB
      if ((numberA === null) !== (numberB === null)) return numberA === null ? 1 : -1
      const timeA = releasedAt(a.video)
      const timeB = releasedAt(b.video)
      if (timeA !== timeB) return timeA < timeB ? -1 : 1
      return a.index - b.index
    })
  return entries.map(({ video }, position) => ({
    id: video.id,
    episodeNum: video.episode ?? position + 1,
    title: video.title ?? '',
    containerExtension: '',
    plot: video.overview ?? '',
    duration: video.runtime ?? '',
    durationSecs: 0,
    rating: 0,
    season: seasonNumber,
    coverUrl: video.thumbnail ?? '',
    streamUrl: '',
    ...(video.airDate ? { airDate: video.airDate } : {})
  }))
}

function seasonInfo(seasonNumber: number, episodeCount: number): SeasonInfo {
  return {
    seasonNumber,
    // Season 0 is left unnamed: the page names its specials.
    name: seasonNumber > 0 ? strings.catalog.detail.season(seasonNumber) : '',
    episodeCount,
    cover: ''
  }
}

/**
 * A series meta as the series page's detail. Episodes are the meta's videos,
 * grouped by season: seasons ascending with season 0 (specials) last,
 * episodes as `addonVideosToEpisodes` orders them. A video without a season
 * number counts as season 1 when no video has one, and is left out
 * otherwise. A meta that lists its `seasons` without their episodes (the
 * built-in TMDB catalogue) gives those seasons with no episodes yet: each is
 * filled when it is opened.
 */
export function addonMetaToSeriesDetail(meta: AddonMeta): SeriesDetail {
  const anySeason = meta.videos.some((video) => video.season !== null)
  const bySeason = new Map<number, AddonVideo[]>()
  for (const video of meta.videos) {
    const season = video.season ?? (anySeason ? null : 1)
    if (season === null) continue
    const list = bySeason.get(season)
    if (list) list.push(video)
    else bySeason.set(season, [video])
  }

  const seasons: SeasonInfo[] = []
  const episodes: Record<number, EpisodeInfo[]> = {}
  if (meta.seasons) {
    const listed = [...meta.seasons].sort((a, b) => seasonOrder(a.season) - seasonOrder(b.season))
    for (const entry of listed) {
      seasons.push(seasonInfo(entry.season, entry.episodeCount))
      const videos = bySeason.get(entry.season)
      if (videos) episodes[entry.season] = addonVideosToEpisodes(videos, entry.season)
    }
  } else {
    const seasonNumbers = [...bySeason.keys()].sort((a, b) => seasonOrder(a) - seasonOrder(b))
    for (const seasonNumber of seasonNumbers) {
      const list = addonVideosToEpisodes(bySeason.get(seasonNumber) ?? [], seasonNumber)
      episodes[seasonNumber] = list
      seasons.push(seasonInfo(seasonNumber, list.length))
    }
  }

  const vod = addonMetaToVodInfo(meta)
  return {
    seriesId: 0,
    name: vod.name,
    cover: vod.cover,
    plot: vod.plot,
    cast: vod.cast,
    director: vod.director,
    genre: vod.genre,
    releaseDate: vod.releaseDate,
    rating: vod.rating,
    backdropPath: vod.backdrop ? [vod.backdrop] : [],
    seasons,
    episodes
  }
}

/** The target of one episode of an add-on series, from its detail. */
export function addonEpisodeTarget(sourceId: string, metaId: string, episode: Pick<EpisodeInfo, 'id'>): AddonPlaybackTarget {
  return addonTarget({ sourceId, contentType: 'series', metaId, videoId: episode.id })
}

/**
 * The episode as the player shows it (and history stores it), like
 * `episodeDisplayChannel` for Xtream: typed as a film, since the player
 * treats an episode like one. No URL.
 */
export function addonEpisodeChannel(input: {
  sourceId: string
  seriesName: string
  episode: Pick<EpisodeInfo, 'id' | 'season' | 'episodeNum' | 'title' | 'coverUrl'>
  coverUrl?: string
}): Channel {
  const { episode } = input
  const cover = episode.coverUrl || input.coverUrl
  return {
    id: `${input.sourceId}_episode_${encodeURIComponent(episode.id)}`,
    name: strings.catalog.detail.episodeTitle(input.seriesName, episode.season, episode.episodeNum, episode.title),
    streamUrl: '',
    sourceId: input.sourceId,
    type: 'vod',
    ...(cover ? { coverUrl: cover } : {})
  }
}

/**
 * The meta of an item from its catalogue source, or null when that source
 * has none for it (an add-on without a `meta` resource for it; the page then
 * shows what the card knows) or cannot ask now. `provider` defaults to an
 * add-on's own (provider.ts); the screens pass the app's, which also knows
 * the built-in TMDB catalogue. Rejects like the client (`XtreamRequestError`
 * kinds, no address or key in it).
 */
export async function loadAddonMeta(
  source: PlaylistSource,
  contentType: AddonContentType,
  metaId: string,
  options: AddonFetchOptions = {},
  provider: AddonCatalogProvider | null = remoteCatalogProvider(source)
): Promise<AddonMeta | null> {
  if (source.type !== 'addon' || !source.addon || !provider) return null
  return provider.meta(contentType, metaId, options)
}

/** The episodes of one season of a meta that lists its `seasons` without them. */
export async function loadAddonSeasonEpisodes(
  provider: AddonCatalogProvider,
  meta: AddonMeta,
  seasonNumber: number,
  options: AddonFetchOptions = {}
): Promise<EpisodeInfo[]> {
  const videos = await provider.seasonVideos(meta, seasonNumber, options)
  return addonVideosToEpisodes(
    videos.filter((video) => video.season === null || video.season === seasonNumber),
    seasonNumber
  )
}
