import type { XtreamCredentials, XtreamAuthResponse, XtreamCategory, XtreamLiveStream, XtreamVODStream, XtreamVODInfo, XtreamSeriesStream, XtreamSeriesInfo } from '@/types/xtream'
import type { Channel, Category } from '@/types/playlist'

function buildUrl(creds: XtreamCredentials, action: string, params?: Record<string, string>): string {
  const base = creds.url.replace(/\/+$/, '')
  const url = new URL(`${base}/player_api.php`)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  if (action) url.searchParams.set('action', action)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  return url.toString()
}

async function fetchJSON<T>(url: string): Promise<T> {
  // Use cache: no-store to avoid stale responses, and don't auto-upgrade HTTP
  const res = await fetch(url, {
    cache: 'no-store',
    // @ts-ignore - Electron supports this to prevent HTTP->HTTPS upgrade
    mode: 'cors'
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.json()
}

export const xtreamApi = {
  async authenticate(creds: XtreamCredentials): Promise<XtreamAuthResponse> {
    const url = buildUrl(creds, '')
    return fetchJSON<XtreamAuthResponse>(url)
  },

  // Live TV
  async getLiveCategories(creds: XtreamCredentials): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_live_categories'))
  },

  async getLiveStreams(creds: XtreamCredentials, categoryId?: string): Promise<XtreamLiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_live_streams', params))
  },

  // VOD
  async getVodCategories(creds: XtreamCredentials): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_vod_categories'))
  },

  async getVodStreams(creds: XtreamCredentials, categoryId?: string): Promise<XtreamVODStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_vod_streams', params))
  },

  async getVodInfo(creds: XtreamCredentials, vodId: number): Promise<XtreamVODInfo> {
    return fetchJSON(buildUrl(creds, 'get_vod_info', { vod_id: String(vodId) }))
  },

  // Series
  async getSeriesCategories(creds: XtreamCredentials): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_series_categories'))
  },

  async getSeries(creds: XtreamCredentials, categoryId?: string): Promise<XtreamSeriesStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_series', params))
  },

  async getSeriesInfo(creds: XtreamCredentials, seriesId: number): Promise<XtreamSeriesInfo> {
    return fetchJSON(buildUrl(creds, 'get_series_info', { series_id: String(seriesId) }))
  },

  // URL builders
  buildLiveUrl(creds: XtreamCredentials, streamId: number, extension = 'm3u8'): string {
    const base = creds.url.replace(/\/+$/, '')
    return `${base}/live/${creds.username}/${creds.password}/${streamId}.${extension}`
  },

  buildVodUrl(creds: XtreamCredentials, streamId: number, extension: string): string {
    const base = creds.url.replace(/\/+$/, '')
    return `${base}/movie/${creds.username}/${creds.password}/${streamId}.${extension}`
  },

  buildSeriesUrl(creds: XtreamCredentials, streamId: number, extension: string): string {
    const base = creds.url.replace(/\/+$/, '')
    return `${base}/series/${creds.username}/${creds.password}/${streamId}.${extension}`
  },

  buildEpgUrl(creds: XtreamCredentials): string {
    const base = creds.url.replace(/\/+$/, '')
    return `${base}/xmltv.php?username=${creds.username}&password=${creds.password}`
  },

  // Convert to app types
  categoriesToApp(cats: XtreamCategory[], sourceId: string, type: 'live' | 'vod' | 'series'): Category[] {
    return cats.map((c) => ({
      id: `${sourceId}_${type}_${c.category_id}`,
      name: c.category_name,
      sourceId,
      type
    }))
  },

  liveStreamsToChannels(streams: XtreamLiveStream[], creds: XtreamCredentials, sourceId: string): Channel[] {
    return streams.map((s) => ({
      id: `${sourceId}_live_${s.stream_id}`,
      name: s.name,
      logo: s.stream_icon || undefined,
      streamUrl: xtreamApi.buildLiveUrl(creds, s.stream_id),
      streamId: s.stream_id,
      sourceId,
      categoryId: s.category_id ? `${sourceId}_live_${s.category_id}` : undefined,
      epgChannelId: s.epg_channel_id || undefined,
      type: 'live' as const,
      isAdult: s.is_adult === '1',
      tvArchive: s.tv_archive === 1,
      tvArchiveDuration: s.tv_archive_duration
    }))
  },

  vodStreamsToChannels(streams: XtreamVODStream[], creds: XtreamCredentials, sourceId: string): Channel[] {
    return streams.map((s) => ({
      id: `${sourceId}_vod_${s.stream_id}`,
      name: s.name,
      logo: s.stream_icon || undefined,
      streamUrl: xtreamApi.buildVodUrl(creds, s.stream_id, s.container_extension || 'mp4'),
      streamId: s.stream_id,
      sourceId,
      categoryId: s.category_id ? `${sourceId}_vod_${s.category_id}` : undefined,
      type: 'vod' as const,
      isAdult: s.is_adult === '1',
      rating: s.rating,
      containerExtension: s.container_extension
    }))
  },

  seriesToChannels(streams: XtreamSeriesStream[], sourceId: string): Channel[] {
    return streams.map((s) => ({
      id: `${sourceId}_series_${s.series_id}`,
      name: s.name,
      logo: s.cover || undefined,
      streamUrl: '',
      seriesId: s.series_id,
      sourceId,
      categoryId: s.category_id ? `${sourceId}_series_${s.category_id}` : undefined,
      type: 'series' as const,
      rating: s.rating,
      plot: s.plot,
      cast: s.cast,
      director: s.director,
      genre: s.genre,
      releaseDate: s.release_date,
      coverUrl: s.cover,
      backdropUrl: s.backdrop_path?.[0]
    }))
  }
}
