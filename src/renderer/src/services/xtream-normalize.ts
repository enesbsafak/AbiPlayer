import type {
  XtreamAuthResponse,
  XtreamCategory,
  XtreamLiveFormat,
  XtreamLiveStream,
  XtreamRawCategory,
  XtreamRawLiveStream,
  XtreamRawSeriesStream,
  XtreamRawServerInfo,
  XtreamRawUserInfo,
  XtreamRawVODStream,
  XtreamSeriesInfo,
  XtreamSeriesStream,
  XtreamUserInfo,
  XtreamVODInfo,
  XtreamVODStream
} from '@/types/xtream'
import { XtreamRequestError, badResponseError } from './xtream-errors'
import { requests } from '@/strings/requests'

// Normalization happens once, at the service boundary. Panels disagree on the
// type of nearly every field ("1" vs 1 vs true, numbers as strings, null for
// empty text), so nothing past this file has to second-guess a value.

type RawRecord = Record<string, unknown>

/** Which list an Xtream answer should have held, for the error that says it did not. */
export type XtreamListKind = keyof typeof requests.xtream.listNames

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text field: strings pass through, numbers are stringified, anything else is ''. */
export function toXtreamString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** Numeric field: numbers and numeric strings, otherwise the fallback. */
export function toXtreamNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/** Positive integer id, or null when the value cannot be one. */
export function toXtreamId(value: unknown): number | null {
  const parsed = toXtreamNumber(value, Number.NaN)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** Flag field: true for 1, "1", true, "true", "yes"; false for everything else. */
export function toXtreamBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    return lower === '1' || lower === 'true' || lower === 'yes'
  }
  return false
}

function toIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const id = toXtreamNumber(item, Number.NaN)
    return Number.isInteger(id) ? [id] : []
  })
}

function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === 'string' && item ? [item] : []))
}

/**
 * Unwrap a list response. Panels return an array, but some return an object
 * keyed by index ({"0": {...}, "1": {...}}) and many return `{}` for an empty
 * category. Anything else (an HTML page parsed as a string, an error object,
 * null) is a bad response rather than a crash further down.
 */
export function toXtreamList(raw: unknown, what: XtreamListKind): unknown[] {
  if (Array.isArray(raw)) return raw
  if (isRecord(raw)) {
    const userInfo = raw.user_info
    if (isRecord(userInfo) && !toXtreamBoolean(userInfo.auth)) {
      throw new XtreamRequestError('auth', requests.xtream.authRejected)
    }
    const keys = Object.keys(raw)
    if (keys.every((key) => /^\d+$/.test(key))) return Object.values(raw)
  }
  throw badResponseError(requests.xtream.missingList(requests.xtream.listNames[what]))
}

export function normalizeXtreamUserInfo(raw: XtreamRawUserInfo): XtreamUserInfo {
  const formats =
    typeof raw.allowed_output_formats === 'string'
      ? raw.allowed_output_formats.split(',')
      : toStringList(raw.allowed_output_formats)

  return {
    username: toXtreamString(raw.username),
    password: toXtreamString(raw.password),
    message: toXtreamString(raw.message),
    auth: toXtreamBoolean(raw.auth) ? 1 : 0,
    status: toXtreamString(raw.status),
    exp_date: toXtreamString(raw.exp_date),
    is_trial: toXtreamString(raw.is_trial),
    active_cons: toXtreamString(raw.active_cons),
    created_at: toXtreamString(raw.created_at),
    max_connections: toXtreamString(raw.max_connections),
    allowed_output_formats: formats.flatMap((format) => {
      const clean = format.trim().toLowerCase()
      return clean ? [clean] : []
    })
  }
}

function normalizeServerInfo(raw: XtreamRawServerInfo) {
  return {
    url: toXtreamString(raw.url),
    port: toXtreamString(raw.port),
    https_port: toXtreamString(raw.https_port),
    server_protocol: toXtreamString(raw.server_protocol),
    rtmp_port: toXtreamString(raw.rtmp_port),
    timezone: toXtreamString(raw.timezone),
    timestamp_now: toXtreamNumber(raw.timestamp_now),
    time_now: toXtreamString(raw.time_now)
  }
}

export function normalizeXtreamAuthResponse(raw: unknown): XtreamAuthResponse {
  if (!isRecord(raw) || !isRecord(raw.user_info)) {
    throw badResponseError(requests.xtream.badAuthResponse)
  }
  return {
    user_info: normalizeXtreamUserInfo(raw.user_info as XtreamRawUserInfo),
    server_info: normalizeServerInfo(isRecord(raw.server_info) ? (raw.server_info as XtreamRawServerInfo) : {})
  }
}

export function normalizeXtreamCategories(raw: unknown): XtreamCategory[] {
  return toXtreamList(raw, 'category').flatMap((item) => {
    if (!isRecord(item)) return []
    const cat = item as XtreamRawCategory
    const id = toXtreamString(cat.category_id)
    if (!id) return []
    return [{
      category_id: id,
      category_name: toXtreamString(cat.category_name),
      parent_id: toXtreamNumber(cat.parent_id)
    }]
  })
}

export function normalizeXtreamLiveStreams(raw: unknown): XtreamLiveStream[] {
  return toXtreamList(raw, 'live').flatMap((item) => {
    if (!isRecord(item)) return []
    const s = item as XtreamRawLiveStream
    const streamId = toXtreamId(s.stream_id)
    if (streamId === null) return []
    return [{
      num: toXtreamNumber(s.num),
      name: toXtreamString(s.name),
      stream_type: toXtreamString(s.stream_type),
      stream_id: streamId,
      stream_icon: toXtreamString(s.stream_icon),
      epg_channel_id: toXtreamString(s.epg_channel_id),
      added: toXtreamString(s.added),
      is_adult: toXtreamBoolean(s.is_adult),
      category_id: toXtreamString(s.category_id),
      category_ids: toIdList(s.category_ids),
      custom_sid: toXtreamString(s.custom_sid),
      tv_archive: toXtreamBoolean(s.tv_archive),
      direct_source: toXtreamString(s.direct_source),
      tv_archive_duration: toXtreamNumber(s.tv_archive_duration)
    }]
  })
}

export function normalizeXtreamVodStreams(raw: unknown): XtreamVODStream[] {
  return toXtreamList(raw, 'vod').flatMap((item) => {
    if (!isRecord(item)) return []
    const s = item as XtreamRawVODStream
    const streamId = toXtreamId(s.stream_id)
    if (streamId === null) return []
    return [{
      num: toXtreamNumber(s.num),
      name: toXtreamString(s.name),
      stream_type: toXtreamString(s.stream_type),
      stream_id: streamId,
      stream_icon: toXtreamString(s.stream_icon),
      rating: toXtreamString(s.rating),
      rating_5based: toXtreamNumber(s.rating_5based),
      added: toXtreamString(s.added),
      is_adult: toXtreamBoolean(s.is_adult),
      category_id: toXtreamString(s.category_id),
      category_ids: toIdList(s.category_ids),
      container_extension: toXtreamString(s.container_extension).trim().replace(/^\./, ''),
      custom_sid: toXtreamString(s.custom_sid),
      direct_source: toXtreamString(s.direct_source)
    }]
  })
}

function normalizeSeriesItem(s: XtreamRawSeriesStream, seriesId: number): XtreamSeriesStream {
  return {
    num: toXtreamNumber(s.num),
    name: toXtreamString(s.name),
    series_id: seriesId,
    cover: toXtreamString(s.cover),
    plot: toXtreamString(s.plot),
    cast: toXtreamString(s.cast),
    director: toXtreamString(s.director),
    genre: toXtreamString(s.genre),
    release_date: toXtreamString(s.release_date) || toXtreamString(s.releaseDate),
    last_modified: toXtreamString(s.last_modified),
    rating: toXtreamString(s.rating),
    rating_5based: toXtreamNumber(s.rating_5based),
    backdrop_path: toStringList(s.backdrop_path),
    youtube_trailer: toXtreamString(s.youtube_trailer),
    episode_run_time: toXtreamString(s.episode_run_time),
    category_id: toXtreamString(s.category_id),
    category_ids: toIdList(s.category_ids)
  }
}

export function normalizeXtreamSeries(raw: unknown): XtreamSeriesStream[] {
  return toXtreamList(raw, 'series').flatMap((item) => {
    if (!isRecord(item)) return []
    const s = item as XtreamRawSeriesStream
    const seriesId = toXtreamId(s.series_id)
    if (seriesId === null) return []
    return [normalizeSeriesItem(s, seriesId)]
  })
}

export function normalizeXtreamVodInfo(raw: unknown): XtreamVODInfo {
  if (!isRecord(raw)) throw badResponseError(requests.xtream.missingVodInfo)
  // A panel that does not know the movie answers `"info": []`.
  const info: RawRecord = isRecord(raw.info) ? raw.info : {}
  const movie: RawRecord = isRecord(raw.movie_data) ? raw.movie_data : {}
  return {
    info: {
      movie_image: toXtreamString(info.movie_image) || toXtreamString(info.cover_big),
      tmdb_id: toXtreamString(info.tmdb_id),
      plot: toXtreamString(info.plot) || toXtreamString(info.description),
      cast: toXtreamString(info.cast) || toXtreamString(info.actors),
      director: toXtreamString(info.director),
      genre: toXtreamString(info.genre),
      release_date: toXtreamString(info.release_date) || toXtreamString(info.releasedate),
      duration: toXtreamString(info.duration),
      duration_secs: toXtreamNumber(info.duration_secs),
      rating: toXtreamString(info.rating),
      name: toXtreamString(info.name),
      year: toXtreamString(info.year)
    },
    movie_data: {
      stream_id: toXtreamNumber(movie.stream_id),
      name: toXtreamString(movie.name),
      added: toXtreamString(movie.added),
      category_id: toXtreamString(movie.category_id),
      container_extension: toXtreamString(movie.container_extension)
    }
  }
}

/**
 * Only the top level is guaranteed here; SeriesDetail already normalizes the
 * nested season and episode values field by field.
 */
export function normalizeXtreamSeriesInfo(raw: unknown): XtreamSeriesInfo {
  if (!isRecord(raw)) throw badResponseError(requests.xtream.missingSeriesInfo)
  const episodes = raw.episodes
  return {
    seasons: Array.isArray(raw.seasons) ? raw.seasons : [],
    info: isRecord(raw.info) ? raw.info : {},
    episodes: isRecord(episodes) || Array.isArray(episodes) ? episodes : {}
  }
}

const LIVE_FORMATS: readonly XtreamLiveFormat[] = ['m3u8', 'ts']

/**
 * Which live formats the account may request. Panels list them in
 * `allowed_output_formats` ("m3u8", "ts", "rtmp"); when the list is missing
 * or names neither, the panel did not restrict anything we can use, so both
 * are assumed.
 */
export function getAllowedLiveFormats(
  auth: Pick<XtreamAuthResponse, 'user_info'> | null | undefined
): XtreamLiveFormat[] {
  const listed = auth?.user_info?.allowed_output_formats ?? []
  const allowed = LIVE_FORMATS.filter((format) =>
    listed.some((entry) => entry === format || (format === 'm3u8' && entry === 'hls'))
  )
  return allowed.length > 0 ? allowed : [...LIVE_FORMATS]
}

/**
 * The live format to request: the preferred one when the account allows it,
 * otherwise whatever it does allow.
 */
export function pickLiveFormat(
  allowed: readonly XtreamLiveFormat[],
  preferred: XtreamLiveFormat
): XtreamLiveFormat {
  if (allowed.includes(preferred)) return preferred
  return allowed[0] ?? preferred
}

/** Xtream timestamps are unix seconds, sent as a number or a numeric string. */
export function parseXtreamTimestamp(value: unknown): number | null {
  const seconds = toXtreamNumber(value, Number.NaN)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}
