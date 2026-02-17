export interface XtreamCredentials {
  url: string
  username: string
  password: string
}

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
  auth: number
  status: string
  exp_date: string
  is_trial: string
  active_cons: string
  created_at: string
  max_connections: string
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
  added: string
  is_adult: string
  category_id: string
  category_ids: number[]
  custom_sid: string
  tv_archive: number
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
  added: string
  is_adult: string
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
  last_modified: string
  rating: string
  rating_5based: number
  backdrop_path: string[]
  youtube_trailer: string
  episode_run_time: string
  category_id: string
  category_ids: number[]
}

export interface XtreamSeriesEpisode {
  id: string
  episode_num: number
  title: string
  container_extension: string
  info: {
    movie_image: string
    plot: string
    duration_secs: number
    duration: string
    rating: number
    name: string
    season: number
  }
  custom_sid: string
  added: string
  season: number
  direct_source: string
}

export interface XtreamSeriesInfo {
  seasons: { season_number: number; name: string; episode_count: number; cover: string }[]
  info: XtreamSeriesStream
  episodes: Record<string, XtreamSeriesEpisode[]>
}
