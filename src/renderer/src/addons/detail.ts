import type { Channel, EpisodeInfo, PlaylistSource, SeasonInfo, SeriesDetail } from '@/types/playlist'
import { strings } from '@/strings'
import { addonTarget, type AddonContentType, type AddonPlaybackTarget } from '../../../shared/playback'
import { fetchAddonMeta, type AddonFetchOptions, type AddonMeta, type AddonVideo } from './client'
import { addonSupports } from './manifest'

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
 * A series meta as the series page's detail. Episodes are the meta's videos,
 * grouped by season: seasons ascending with season 0 (specials) last,
 * episodes by number, then release date, then the add-on's order. A video
 * without a season number counts as season 1 when no video has one, and is
 * left out otherwise. An episode without a number gets its place in the
 * season. `EpisodeInfo.id` is the video id (what the stream request takes);
 * `streamUrl` stays empty.
 */
export function addonMetaToSeriesDetail(meta: AddonMeta): SeriesDetail {
  const anySeason = meta.videos.some((video) => video.season !== null)
  const bySeason = new Map<number, Array<{ video: AddonVideo; index: number }>>()
  meta.videos.forEach((video, index) => {
    const season = video.season ?? (anySeason ? null : 1)
    if (season === null) return
    const list = bySeason.get(season)
    if (list) list.push({ video, index })
    else bySeason.set(season, [{ video, index }])
  })

  const seasonNumbers = [...bySeason.keys()].sort((a, b) => seasonOrder(a) - seasonOrder(b))
  const seasons: SeasonInfo[] = []
  const episodes: Record<number, EpisodeInfo[]> = {}
  for (const seasonNumber of seasonNumbers) {
    const entries = (bySeason.get(seasonNumber) ?? []).slice().sort((a, b) => {
      const numberA = a.video.episode
      const numberB = b.video.episode
      if (numberA !== null && numberB !== null && numberA !== numberB) return numberA - numberB
      if ((numberA === null) !== (numberB === null)) return numberA === null ? 1 : -1
      const timeA = releasedAt(a.video)
      const timeB = releasedAt(b.video)
      if (timeA !== timeB) return timeA < timeB ? -1 : 1
      return a.index - b.index
    })
    episodes[seasonNumber] = entries.map(({ video }, position) => ({
      id: video.id,
      episodeNum: video.episode ?? position + 1,
      title: video.title ?? '',
      containerExtension: '',
      plot: video.overview ?? '',
      duration: '',
      durationSecs: 0,
      rating: 0,
      season: seasonNumber,
      coverUrl: video.thumbnail ?? '',
      streamUrl: ''
    }))
    seasons.push({
      seasonNumber,
      // Season 0 is left unnamed: the page names its specials.
      name: seasonNumber > 0 ? strings.catalog.detail.season(seasonNumber) : '',
      episodeCount: entries.length,
      cover: ''
    })
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
 * The meta of an item from its catalogue add-on, or null when that add-on
 * has no `meta` resource for it (the page then shows what the card knows).
 * Rejects like the client (`XtreamRequestError` kinds, no address in it).
 */
export async function loadAddonMeta(
  source: PlaylistSource,
  contentType: AddonContentType,
  metaId: string,
  options: AddonFetchOptions = {}
): Promise<AddonMeta | null> {
  if (source.type !== 'addon' || !source.url || !source.addon) return null
  if (!addonSupports(source.addon, 'meta', contentType, metaId)) return null
  return fetchAddonMeta(source.url, contentType, metaId, options)
}
