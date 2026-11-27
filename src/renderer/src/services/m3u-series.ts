import type { Channel, EpisodeInfo, M3uEpisode, SeasonInfo, SeriesDetail } from '@/types/playlist'
import type { QueuedEpisode } from '@/types/player'
import { m3uEntryId, mediaKey, stableHash, type M3uPlaybackTarget } from '../../../shared/playback'
import { strings } from '@/strings'

const text = strings.catalog.detail

/*
 * An M3U list has no series: every episode is an entry of its own, named
 * "Dizi Adı S01 E02" or the like. The entries of a series group are gathered
 * here into one item per series that carries its episodes, so the series
 * page, the "next episode" button and the per-series subtitle memory work for
 * a playlist as they do for an Xtream account.
 *
 * Only an entry whose name says which episode it is gets grouped; anything
 * else stays a card of its own.
 */

/** Marks the id of a series item made here; such an item has no address of its own. */
const SERIES_ID_MARK = '_m3u_series_'

export function isM3uSeriesItem(channel: Pick<Channel, 'id' | 'type'>): boolean {
  return channel.type === 'series' && channel.id.includes(SERIES_ID_MARK)
}

export interface ParsedEpisodeName {
  series: string
  season: number
  episode: number
  /** What follows the episode mark ("Pilot"), often empty. */
  title: string
}

// Separators lists put around the episode mark: "Dizi - S01E02 - Pilot", "Dizi | 1x02".
const SEP = String.raw`[\s._\-–—|:]*`
// "bölüm", with either spelling of its vowels (lists are often typed without Turkish letters).
const EPISODE_WORD = 'b[öo]l[üu]m'
const PATTERNS: Array<{ pattern: RegExp; season: number | null; episode: number }> = [
  // Dizi S01E02, Dizi S01 E02, Dizi S1.E2
  { pattern: new RegExp(String.raw`^(.*?)${SEP}\bS(\d{1,2})[\s._-]*E(\d{1,4})\b${SEP}(.*)$`, 'i'), season: 2, episode: 3 },
  // Dizi 1. Sezon 2. Bölüm, Dizi 1.Sezon 2.Bölüm
  { pattern: new RegExp(String.raw`^(.*?)${SEP}\b(\d{1,2})\.?\s*sezon${SEP}(\d{1,4})\.?\s*${EPISODE_WORD}\b${SEP}(.*)$`, 'i'), season: 2, episode: 3 },
  // Dizi Sezon 1 Bölüm 2
  { pattern: new RegExp(String.raw`^(.*?)${SEP}\bsezon\s*(\d{1,2})${SEP}${EPISODE_WORD}\s*(\d{1,4})\b${SEP}(.*)$`, 'i'), season: 2, episode: 3 },
  // Dizi 1x02
  { pattern: new RegExp(String.raw`^(.*?)[\s._\-–—|:]+(\d{1,2})x(\d{2,3})\b${SEP}(.*)$`, 'i'), season: 2, episode: 3 },
  // Dizi 12. Bölüm (no season: the first)
  { pattern: new RegExp(String.raw`^(.*?)${SEP}\b(\d{1,4})\.?\s*${EPISODE_WORD}\b${SEP}(.*)$`, 'i'), season: null, episode: 2 },
  // Dizi Bölüm 12, Dizi Episode 12, Dizi Ep 12
  { pattern: new RegExp(String.raw`^(.*?)${SEP}\b(?:${EPISODE_WORD}|episode|ep)\.?\s*(\d{1,4})\b${SEP}(.*)$`, 'i'), season: null, episode: 2 }
]

/** Cheap first look: most names (channels, films) have none of these. */
const EPISODE_HINT = /\bS\d{1,2}[\s._-]*E\d|\d{1,2}x\d{2}|b[öo]l[üu]m|\bepisode\b|\bep\.?\s*\d/i

export function looksLikeEpisodeName(name: string): boolean {
  return EPISODE_HINT.test(name)
}

/** The series, season and episode an entry's name states, or null when it states none. */
export function parseEpisodeName(name: string): ParsedEpisodeName | null {
  if (!EPISODE_HINT.test(name)) return null
  for (const { pattern, season, episode } of PATTERNS) {
    const match = pattern.exec(name)
    if (!match) continue
    const series = (match[1] ?? '').trim()
    if (!series) continue
    return {
      series,
      season: season === null ? 1 : Number(match[season]),
      episode: Number(match[episode]),
      title: (match[match.length - 1] ?? '').trim()
    }
  }
  return null
}

function seriesKey(name: string): string {
  return name.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()
}

/**
 * The list with the episodes of series-type entries gathered into one item
 * per series, each at the place of its first episode. Series are kept apart
 * per group: two groups may list different series under one name.
 */
export function groupSeriesEntries(sourceId: string, channels: Channel[]): Channel[] {
  const result: Channel[] = []
  const byKey = new Map<string, Channel>()
  for (const channel of channels) {
    const parsed = channel.type === 'series' ? parseEpisodeName(channel.name) : null
    if (!parsed) {
      result.push(channel)
      continue
    }
    const key = `${channel.categoryId ?? ''}\n${seriesKey(parsed.series)}`
    let series = byKey.get(key)
    if (!series) {
      series = {
        id: `${sourceId}${SERIES_ID_MARK}${stableHash(key)}`,
        name: parsed.series,
        streamUrl: '',
        sourceId,
        type: 'series',
        m3uEpisodes: [],
        ...(channel.logo ? { logo: channel.logo } : {}),
        ...(channel.categoryId ? { categoryId: channel.categoryId } : {}),
        ...(channel.categoryName ? { categoryName: channel.categoryName } : {}),
        ...(channel.group ? { group: channel.group } : {})
      }
      byKey.set(key, series)
      result.push(series)
    }
    if (channel.isAdult) series.isAdult = true
    const episode: M3uEpisode = {
      id: channel.id,
      season: parsed.season,
      episode: parsed.episode,
      title: parsed.title,
      streamUrl: channel.streamUrl,
      ...(channel.logo ? { logo: channel.logo } : {}),
      ...(channel.httpHeaders ? { httpHeaders: channel.httpHeaders } : {})
    }
    series.m3uEpisodes!.push(episode)
  }
  for (const series of byKey.values()) {
    // Stable: two entries of the same episode (two qualities) keep the list's order.
    series.m3uEpisodes!.sort((a, b) => a.season - b.season || a.episode - b.episode)
  }
  return result
}

/** The episode as the player shows and plays it. `seriesRef` ties it to its series. */
export function m3uEpisodeChannel(series: Channel, episode: M3uEpisode): Channel {
  const cover = episode.logo ?? series.logo
  return {
    id: episode.id,
    name: episode.title
      ? text.episodeTitle(series.name, episode.season, episode.episode, episode.title)
      : text.episodeTitleShort(series.name, episode.season, episode.episode),
    streamUrl: episode.streamUrl,
    sourceId: series.sourceId,
    type: 'series',
    seriesRef: series.id,
    ...(cover ? { logo: cover, coverUrl: cover } : {}),
    ...(series.categoryId ? { categoryId: series.categoryId } : {}),
    ...(series.categoryName ? { categoryName: series.categoryName } : {}),
    ...(episode.httpHeaders ? { httpHeaders: episode.httpHeaders } : {})
  }
}

export function m3uEpisodeTarget(sourceId: string, episode: Pick<M3uEpisode, 'streamUrl'>): M3uPlaybackTarget {
  return { kind: 'm3u', sourceId, entryId: m3uEntryId(episode.streamUrl), mediaType: 'series' }
}

/** Every episode of the series in watching order, as the player's queue takes them. */
export function m3uSeriesQueue(series: Channel): QueuedEpisode[] {
  return (series.m3uEpisodes ?? []).map((episode) => {
    const target = m3uEpisodeTarget(series.sourceId, episode)
    const channel = m3uEpisodeChannel(series, episode)
    return { mediaKey: mediaKey(target), title: channel.name, request: { target, channel } }
  })
}

/** The series as its page shows it: seasons and episodes, nothing a list does not say. */
export function m3uSeriesDetail(series: Channel): SeriesDetail {
  const episodes: Record<number, EpisodeInfo[]> = {}
  for (const episode of series.m3uEpisodes ?? []) {
    const list = (episodes[episode.season] ??= [])
    list.push({
      id: episode.id,
      episodeNum: episode.episode,
      title: episode.title,
      containerExtension: '',
      plot: '',
      duration: '',
      durationSecs: 0,
      rating: 0,
      season: episode.season,
      coverUrl: episode.logo ?? '',
      streamUrl: episode.streamUrl
    })
  }
  const seasons: SeasonInfo[] = Object.keys(episodes)
    .map(Number)
    .sort((a, b) => a - b)
    .map((seasonNumber) => ({ seasonNumber, name: '', episodeCount: episodes[seasonNumber]?.length ?? 0, cover: '' }))
  return {
    seriesId: 0,
    name: series.name,
    cover: series.logo ?? '',
    plot: '',
    cast: '',
    director: '',
    genre: '',
    releaseDate: '',
    rating: '',
    backdropPath: [],
    seasons,
    episodes
  }
}

interface SeriesLookup {
  getItem(id: string): Channel | undefined
  getItems(sourceId: string, type: Channel['type']): readonly Channel[]
}

/**
 * The episode of a grouped series that `matches`, as a playable channel.
 * History and favourites kept from before the grouping name an episode by its
 * own id or by the hash of its address; neither is a list item any more.
 */
export function findM3uEpisode(
  lookup: SeriesLookup,
  sourceId: string,
  matches: (episode: M3uEpisode) => boolean
): Channel | null {
  for (const item of lookup.getItems(sourceId, 'series')) {
    const episode = item.m3uEpisodes?.find(matches)
    if (episode) return m3uEpisodeChannel(item, episode)
  }
  return null
}
