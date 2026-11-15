export interface XtreamCredentials {
  url: string
  username: string
  password: string
}

/**
 * A scalar exactly as Xtream panels send it. The same field arrives as "1",
 * 1, true, "", null or not at all depending on the panel software and
 * version, so nothing coming off the wire can be trusted to have one type.
 */
export type XtreamScalar = string | number | boolean | null | undefined

/** Live output formats the app can request from a panel. */
export type XtreamLiveFormat = 'ts' | 'm3u8'

// ---------------------------------------------------------------------------
// Raw shapes: what panels really send. Every field is optional and loosely
// typed. These are only read by the normalizer in services/xtream-normalize.ts.
// ---------------------------------------------------------------------------

export interface XtreamRawUserInfo {
  username?: XtreamScalar
  password?: XtreamScalar
  message?: XtreamScalar
  auth?: XtreamScalar
  status?: XtreamScalar
  exp_date?: XtreamScalar
  is_trial?: XtreamScalar
  active_cons?: XtreamScalar
  created_at?: XtreamScalar
  max_connections?: XtreamScalar
  /** Usually an array of strings; some panels send a comma-separated string. */
  allowed_output_formats?: unknown
}

export interface XtreamRawServerInfo {
  url?: XtreamScalar
  port?: XtreamScalar
  https_port?: XtreamScalar
  server_protocol?: XtreamScalar
  rtmp_port?: XtreamScalar
  timezone?: XtreamScalar
  timestamp_now?: XtreamScalar
  time_now?: XtreamScalar
}

export interface XtreamRawCategory {
  category_id?: XtreamScalar
  category_name?: XtreamScalar
  parent_id?: XtreamScalar
}

export interface XtreamRawLiveStream {
  num?: XtreamScalar
  name?: XtreamScalar
  stream_type?: XtreamScalar
  stream_id?: XtreamScalar
  stream_icon?: XtreamScalar
  epg_channel_id?: XtreamScalar
  added?: XtreamScalar
  is_adult?: XtreamScalar
  category_id?: XtreamScalar
  category_ids?: unknown
  custom_sid?: XtreamScalar
  tv_archive?: XtreamScalar
  direct_source?: XtreamScalar
  tv_archive_duration?: XtreamScalar
}

export interface XtreamRawVODStream {
  num?: XtreamScalar
  name?: XtreamScalar
  stream_type?: XtreamScalar
  stream_id?: XtreamScalar
  stream_icon?: XtreamScalar
  rating?: XtreamScalar
  rating_5based?: XtreamScalar
  added?: XtreamScalar
  is_adult?: XtreamScalar
  category_id?: XtreamScalar
  category_ids?: unknown
  container_extension?: XtreamScalar
  custom_sid?: XtreamScalar
  direct_source?: XtreamScalar
}

export interface XtreamRawSeriesStream {
  num?: XtreamScalar
  name?: XtreamScalar
  series_id?: XtreamScalar
  cover?: XtreamScalar
  plot?: XtreamScalar
  cast?: XtreamScalar
  director?: XtreamScalar
  genre?: XtreamScalar
  release_date?: XtreamScalar
  releaseDate?: XtreamScalar
  last_modified?: XtreamScalar
  rating?: XtreamScalar
  rating_5based?: XtreamScalar
  /** An array of URLs, a single URL string, or missing. */
  backdrop_path?: unknown
  youtube_trailer?: XtreamScalar
  episode_run_time?: XtreamScalar
  category_id?: XtreamScalar
  category_ids?: unknown
}

// ---------------------------------------------------------------------------
// Normalized shapes: what the service layer returns. Every field has the type
// it claims; missing text is '' and missing numbers are 0.
// ---------------------------------------------------------------------------

export interface XtreamServerInfo {
  url: string
  port: string
  https_port: string
  server_protocol: string
  rtmp_port: string
  timezone: string
  timestamp_now: number
  time_now: string
}

export interface XtreamUserInfo {
  username: string
  password: string
  message: string
  /** 1 when the panel accepted the credentials, otherwise 0. */
  auth: number
  status: string
  exp_date: string
  is_trial: string
  active_cons: string
  created_at: string
  max_connections: string
  /** Lowercased format names, e.g. ["m3u8", "ts"]. Empty when the panel did not say. */
  allowed_output_formats: string[]
}

export interface XtreamAuthResponse {
  user_info: XtreamUserInfo
  server_info: XtreamServerInfo
}

export interface XtreamCategory {
  category_id: string
  category_name: string
  parent_id: number
}

export interface XtreamLiveStream {
  num: number
  name: string
  stream_type: string
  stream_id: number
  stream_icon: string
  epg_channel_id: string
  /** Unix seconds as a string, '' when the panel does not send it. */
  added: string
  is_adult: boolean
  category_id: string
  category_ids: number[]
  custom_sid: string
  tv_archive: boolean
  direct_source: string
  tv_archive_duration: number
}

export interface XtreamVODStream {
  num: number
  name: string
  stream_type: string
  stream_id: number
  stream_icon: string
  rating: string
  rating_5based: number
  /** Unix seconds as a string, '' when the panel does not send it. */
  added: string
  is_adult: boolean
  category_id: string
  category_ids: number[]
  container_extension: string
  custom_sid: string
  direct_source: string
}

export interface XtreamVODInfo {
  info: {
    movie_image: string
    tmdb_id: string
    plot: string
    cast: string
    director: string
    genre: string
    release_date: string
    duration: string
    duration_secs: number
    rating: string
    name: string
    year: string
  }
  movie_data: {
    stream_id: number
    name: string
    added: string
    category_id: string
    container_extension: string
  }
}

export interface XtreamSeriesStream {
  num: number
  name: string
  series_id: number
  cover: string
  plot: string
  cast: string
  director: string
  genre: string
  release_date: string
  /** Unix seconds as a string, '' when the panel does not send it. */
  last_modified: string
  rating: string
  rating_5based: number
  backdrop_path: string[]
  youtube_trailer: string
  episode_run_time: string
  category_id: string
  category_ids: number[]
}

/**
 * Series info is passed through with only its top-level shape guaranteed.
 * The nested values are still panel data (`info` is `[]` on some panels,
 * `episodes` is sometimes an array instead of a season map), so they are
 * typed as unknown: SeriesDetail normalizes them field by field into
 * `SeasonInfo` / `EpisodeInfo`.
 */
export interface XtreamSeriesInfo {
  seasons: unknown[]
  info: Record<string, unknown>
  episodes: Record<string, unknown> | unknown[]
}
