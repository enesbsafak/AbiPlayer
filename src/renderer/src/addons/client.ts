import { USER_ERROR_MESSAGES } from '@/services/user-error'
import { XtreamRequestError, requestHost } from '@/services/xtream-errors'
import type { AddonCatalogSummary, AddonManifestSummary } from '@/types/addon'
import { addonManifestUrl, addonResourceUrl } from './address'
import { summarizeManifest } from './manifest'
import { fetchAddonJson, type AddonRequestOptions } from './request'
import {
  isRecord,
  readArray,
  readCount,
  readHttpUrl,
  readId,
  readSize,
  readText,
  readTextList
} from './validate'

/*
 * The four requests the app makes of an add-on (Stremio add-on protocol):
 * manifest, one catalogue page, one meta, the streams of one video. Each
 * answer is validated and cut down to plain values of bounded size before
 * anything else sees it. `base` is the normalised base address
 * (`normalizeAddonAddress`); it is a secret and never appears in an error.
 */

/** Body limits per answer: a manifest is small, a series meta with every episode is not. */
export const ADDON_MAX_BYTES = {
  manifest: 512 * 1024,
  catalog: 4 * 1024 * 1024,
  meta: 4 * 1024 * 1024,
  stream: 2 * 1024 * 1024
} as const

const MAX_METAS_PER_PAGE = 500
const MAX_VIDEOS = 5_000
const MAX_STREAMS = 200
const MAX_ID_LENGTH = 512
const MAX_NAME_LENGTH = 300
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_SHORT_TEXT_LENGTH = 120
const MAX_PEOPLE = 40
const MAX_GENRES = 20

export type AddonFetchOptions = Omit<AddonRequestOptions, 'maxBytes'>

/** A catalogue entry (meta preview), validated. */
export interface AddonMetaPreview {
  id: string
  /** The add-on's content type (`movie`, `series`, ...). */
  type: string
  name: string
  poster: string | null
  background: string | null
  /** A four-digit year when one is given (`year`, or the start of `releaseInfo`). */
  year: string | null
  releaseInfo: string | null
  /** `imdbRating` as text (e.g. "7.4"). */
  rating: string | null
  description: string | null
  genres: string[]
}

/** One video of a series meta: an episode. */
export interface AddonVideo {
  /** What the stream request takes. */
  id: string
  title: string | null
  season: number | null
  episode: number | null
  /** ISO date text as the add-on gave it. */
  released: string | null
  thumbnail: string | null
  overview: string | null
  /** Running time as text ("45 dk"); only the built-in TMDB catalogue gives it. */
  runtime?: string | null
  /** The air date to show; only the built-in TMDB catalogue gives it. */
  airDate?: string | null
}

/** A season of a series whose episodes are fetched one season at a time (the built-in TMDB catalogue). */
export interface AddonSeason {
  season: number
  episodeCount: number
}

export interface AddonMeta extends AddonMetaPreview {
  cast: string[]
  director: string[]
  /** As the add-on wrote it, e.g. "112 min". */
  runtime: string | null
  videos: AddonVideo[]
  /**
   * What the streams of this film (or of the series' episodes, as
   * `<id>:<season>:<episode>`) are asked by, when it is not the meta id: the
   * built-in TMDB catalogue's IMDb id; null when there is none, so no stream
   * add-on can be asked. Absent for an add-on's own meta.
   */
  streamId?: string | null
  /**
   * The series' seasons when `videos` does not list the episodes: each
   * season's episodes are fetched when it is opened
   * (`AddonCatalogProvider.seasonVideos`). Absent for an add-on's own meta.
   */
  seasons?: AddonSeason[]
}

/**
 * A stream with an http(s) URL. Others (torrent hashes, external links,
 * video-site ids, usenet) are dropped: the app plays only http and https.
 * `url` is a secret (it often holds the add-on's key): it goes to the stream
 * registry and nowhere else.
 */
export interface AddonStream {
  url: string
  /** Short label, as the add-on wrote it (may be two lines). */
  name: string | null
  /** `description`, or the older `title`: free text, often several lines. */
  description: string | null
  bingeGroup: string | null
  filename: string | null
  videoSize: number | null
  notWebReady: boolean
}

export interface AddonCatalogPage {
  metas: AddonMetaPreview[]
  /** Entries in the answer before validation: what `skip` advances by. */
  received: number
  /** The answer says it is the last page (the built-in TMDB catalogue knows its page count). */
  ended?: boolean
  /** Entries in every page together, when the answer says (TMDB's `total_results`). */
  total?: number
}

function badResponse(base: string): XtreamRequestError {
  return new XtreamRequestError('bad-response', USER_ERROR_MESSAGES['bad-response'], { host: requestHost(base) })
}

function readYear(year: unknown, releaseInfo: string | null): string | null {
  const direct = typeof year === 'number' && Number.isInteger(year) ? String(year) : typeof year === 'string' ? year : null
  const match = (direct ?? releaseInfo ?? '').match(/\b(\d{4})\b/)
  return match?.[1] ?? null
}

function readRating(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = readText(value, 16)
  return text && /^\d{1,2}(?:[.,]\d{1,2})?$/.test(text) ? text.replace(',', '.') : null
}

function readMetaPreview(raw: unknown): AddonMetaPreview | null {
  if (!isRecord(raw)) return null
  const id = readId(raw.id, MAX_ID_LENGTH)
  const type = readId(raw.type, 64)
  const name = readText(raw.name, MAX_NAME_LENGTH)
  if (!id || !type || !name) return null
  const releaseInfo = readText(raw.releaseInfo, MAX_SHORT_TEXT_LENGTH)
  return {
    id,
    type,
    name,
    poster: readHttpUrl(raw.poster),
    background: readHttpUrl(raw.background),
    year: readYear(raw.year, releaseInfo),
    releaseInfo,
    rating: readRating(raw.imdbRating),
    description: readText(raw.description, MAX_DESCRIPTION_LENGTH, { multiline: true }),
    genres: readTextList(raw.genres ?? raw.genre, MAX_GENRES, MAX_SHORT_TEXT_LENGTH)
  }
}

function readVideo(raw: unknown): AddonVideo | null {
  if (!isRecord(raw)) return null
  const id = readId(raw.id, MAX_ID_LENGTH)
  if (!id) return null
  return {
    id,
    title: readText(raw.title, MAX_NAME_LENGTH) ?? readText(raw.name, MAX_NAME_LENGTH),
    season: readCount(raw.season),
    episode: readCount(raw.episode) ?? readCount(raw.number),
    released: readText(raw.released, 40),
    thumbnail: readHttpUrl(raw.thumbnail),
    overview:
      readText(raw.overview, MAX_DESCRIPTION_LENGTH, { multiline: true }) ??
      readText(raw.description, MAX_DESCRIPTION_LENGTH, { multiline: true })
  }
}

/** The meta previews of a catalogue answer; entries of the wrong shape are dropped, repeats too. */
export function parseCatalogPage(data: unknown): AddonCatalogPage | null {
  if (!isRecord(data) || !Array.isArray(data.metas)) return null
  const metas: AddonMetaPreview[] = []
  const seen = new Set<string>()
  for (const raw of readArray(data.metas, MAX_METAS_PER_PAGE)) {
    const meta = readMetaPreview(raw)
    if (!meta || seen.has(meta.id)) continue
    seen.add(meta.id)
    metas.push(meta)
  }
  return { metas, received: Math.min(data.metas.length, MAX_METAS_PER_PAGE) }
}

/** The meta of a meta answer, or null when it has none of the right shape. */
export function parseMeta(data: unknown): AddonMeta | null {
  if (!isRecord(data)) return null
  const preview = readMetaPreview(data.meta)
  if (!preview || !isRecord(data.meta)) return null
  const raw = data.meta
  const videos: AddonVideo[] = []
  const seen = new Set<string>()
  for (const entry of readArray(raw.videos, MAX_VIDEOS)) {
    const video = readVideo(entry)
    if (!video || seen.has(video.id)) continue
    seen.add(video.id)
    videos.push(video)
  }
  return {
    ...preview,
    cast: readTextList(raw.cast, MAX_PEOPLE, MAX_SHORT_TEXT_LENGTH),
    director: readTextList(raw.director, MAX_PEOPLE, MAX_SHORT_TEXT_LENGTH),
    runtime: readText(raw.runtime, MAX_SHORT_TEXT_LENGTH),
    videos
  }
}

/** The playable streams of a stream answer, in the add-on's order. */
export function parseStreams(data: unknown): AddonStream[] | null {
  if (!isRecord(data) || !Array.isArray(data.streams)) return null
  const streams: AddonStream[] = []
  for (const raw of readArray(data.streams, MAX_STREAMS)) {
    if (!isRecord(raw)) continue
    const url = readHttpUrl(raw.url)
    if (!url) continue
    const hints = isRecord(raw.behaviorHints) ? raw.behaviorHints : {}
    streams.push({
      url,
      name: readText(raw.name, MAX_NAME_LENGTH, { multiline: true }),
      description:
        readText(raw.description, MAX_DESCRIPTION_LENGTH, { multiline: true }) ??
        readText(raw.title, MAX_DESCRIPTION_LENGTH, { multiline: true }),
      bingeGroup: readText(hints.bingeGroup, MAX_NAME_LENGTH),
      filename: readText(hints.filename, MAX_NAME_LENGTH),
      videoSize: readSize(hints.videoSize),
      notWebReady: hints.notWebReady === true
    })
  }
  return streams
}

export async function fetchAddonManifest(base: string, options: AddonFetchOptions = {}): Promise<AddonManifestSummary> {
  const data = await fetchAddonJson(addonManifestUrl(base), { ...options, maxBytes: ADDON_MAX_BYTES.manifest })
  const summary = summarizeManifest(data)
  if (!summary) throw badResponse(base)
  return summary
}

/**
 * One page of a catalogue; `skip` is the number of entries already received
 * (0 for the first page). With `search`, the page of a search catalogue's
 * answer to that query (the `search` extra property).
 */
export async function fetchAddonCatalogPage(
  base: string,
  catalog: Pick<AddonCatalogSummary, 'type' | 'id'>,
  skip: number,
  options: AddonFetchOptions = {},
  search?: string
): Promise<AddonCatalogPage> {
  const extra = [...(search !== undefined ? [['search', search] as const] : []), ...(skip > 0 ? [['skip', skip] as const] : [])]
  const data = await fetchAddonJson(addonResourceUrl(base, 'catalog', catalog.type, catalog.id, extra), {
    ...options,
    maxBytes: ADDON_MAX_BYTES.catalog
  })
  const page = parseCatalogPage(data)
  if (!page) throw badResponse(base)
  return page
}

export async function fetchAddonMeta(base: string, type: string, id: string, options: AddonFetchOptions = {}): Promise<AddonMeta> {
  const data = await fetchAddonJson(addonResourceUrl(base, 'meta', type, id), { ...options, maxBytes: ADDON_MAX_BYTES.meta })
  const meta = parseMeta(data)
  if (!meta) throw badResponse(base)
  return meta
}

export async function fetchAddonStreams(
  base: string,
  type: string,
  videoId: string,
  options: AddonFetchOptions = {}
): Promise<AddonStream[]> {
  const data = await fetchAddonJson(addonResourceUrl(base, 'stream', type, videoId), {
    ...options,
    maxBytes: ADDON_MAX_BYTES.stream
  })
  const streams = parseStreams(data)
  if (!streams) throw badResponse(base)
  return streams
}
