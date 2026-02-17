import type { XtreamCredentials, XtreamAuthResponse, XtreamCategory, XtreamLiveStream, XtreamVODStream, XtreamVODInfo, XtreamSeriesStream, XtreamSeriesInfo } from '@/types/xtream'
import type { Channel, Category } from '@/types/playlist'

const XTREAM_REQUEST_TIMEOUT_MS = 20_000
const PREVIEW_SCAN_CATEGORY_LIMIT = 12
const XTREAM_DEFAULT_CACHE_TTL_MS = 45_000

const requestCache = new Map<string, { expiresAt: number; data: unknown }>()
const inflightRequests = new Map<string, Promise<unknown>>()

async function collectPreviewFromCategories<T, K extends string | number>({
  categoryIds,
  maxItems,
  maxCategories = PREVIEW_SCAN_CATEGORY_LIMIT,
  maxConcurrency = 4,
  fetchByCategory,
  getKey
}: {
  categoryIds: string[]
  maxItems: number
  maxCategories?: number
  maxConcurrency?: number
  fetchByCategory: (categoryId: string) => Promise<T[]>
  getKey: (item: T) => K
}): Promise<T[]> {
  const result: T[] = []
  const seen = new Set<K>()
  const queue = categoryIds.slice(0, maxCategories)
  const workerCount = Math.max(1, Math.min(maxConcurrency, queue.length || 1))
  let cursor = 0
  let done = false

  const workers = Array.from({ length: workerCount }, async () => {
    while (!done) {
      const index = cursor
      cursor += 1
      if (index >= queue.length) return

      const categoryId = queue[index]
      let items: T[] = []
      try {
        items = await fetchByCategory(categoryId)
      } catch {
        continue
      }

      for (const item of items) {
        const key = getKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        result.push(item)

        if (result.length >= maxItems) {
          done = true
          return
        }
      }
    }
  })

  await Promise.all(workers)
  return result
}

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

async function fetchJSON<T>(
  url: string,
  options?: { bypassCache?: boolean; cacheTtlMs?: number }
): Promise<T> {
  const bypassCache = options?.bypassCache ?? false
  const cacheTtlMs = options?.cacheTtlMs ?? XTREAM_DEFAULT_CACHE_TTL_MS

  if (!bypassCache && cacheTtlMs > 0) {
    const cached = requestCache.get(url)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T
    }

    const existing = inflightRequests.get(url)
    if (existing) {
      return existing as Promise<T>
    }
  }

  const request = (async () => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), XTREAM_REQUEST_TIMEOUT_MS)

  // Use cache: no-store to avoid stale responses, and don't auto-upgrade HTTP
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      // @ts-ignore - Electron supports this to prevent HTTP->HTTPS upgrade
      mode: 'cors'
    })

    const body = await res.text()
    if (!res.ok) {
      const sample = body.slice(0, 160).replace(/\s+/g, ' ').trim()
      throw new Error(`HTTP ${res.status}: ${res.statusText}${sample ? ` (${sample})` : ''}`)
    }

    try {
      const data = JSON.parse(body) as T
      if (!bypassCache && cacheTtlMs > 0) {
        requestCache.set(url, { data, expiresAt: Date.now() + cacheTtlMs })
      }
      return data
    } catch {
      const sample = body.slice(0, 200).replace(/\s+/g, ' ').trim()
      throw new Error(`Gecersiz sunucu yaniti. JSON bekleniyordu: ${sample || 'bos govde'}`)
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Istek zaman asimina ugradi (${XTREAM_REQUEST_TIMEOUT_MS / 1000}s)`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  })()

  if (!bypassCache && cacheTtlMs > 0) {
    inflightRequests.set(url, request as Promise<unknown>)
  }

  try {
    return await request
  } finally {
    inflightRequests.delete(url)
  }
}

export const xtreamApi = {
  async authenticate(creds: XtreamCredentials): Promise<XtreamAuthResponse> {
    const url = buildUrl(creds, '')
    return fetchJSON<XtreamAuthResponse>(url, { bypassCache: true })
  },

  // Live TV
  async getLiveCategories(creds: XtreamCredentials): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_live_categories'))
  },

  async getLiveStreams(creds: XtreamCredentials, categoryId?: string): Promise<XtreamLiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_live_streams', params))
  },

  async getLivePreviewStreams(creds: XtreamCredentials, maxItems = 500): Promise<XtreamLiveStream[]> {
    const categories = await xtreamApi.getLiveCategories(creds).catch(() => [])
    const categoryIds = categories.map((cat) => cat.category_id).filter(Boolean)

    const byCategories = await collectPreviewFromCategories<XtreamLiveStream, number>({
      categoryIds,
      maxItems,
      fetchByCategory: (categoryId) => xtreamApi.getLiveStreams(creds, categoryId),
      getKey: (stream) => stream.stream_id
    })
    if (byCategories.length > 0) return byCategories.slice(0, maxItems)

    const all = await xtreamApi.getLiveStreams(creds)
    return all.slice(0, maxItems)
  },

  // VOD
  async getVodCategories(creds: XtreamCredentials): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_vod_categories'))
  },

  async getVodStreams(creds: XtreamCredentials, categoryId?: string): Promise<XtreamVODStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_vod_streams', params))
  },

  async getVodPreviewStreams(creds: XtreamCredentials, maxItems = 500): Promise<XtreamVODStream[]> {
    const categories = await xtreamApi.getVodCategories(creds).catch(() => [])
    const categoryIds = categories.map((cat) => cat.category_id).filter(Boolean)

    const byCategories = await collectPreviewFromCategories<XtreamVODStream, number>({
      categoryIds,
      maxItems,
      fetchByCategory: (categoryId) => xtreamApi.getVodStreams(creds, categoryId),
      getKey: (stream) => stream.stream_id
    })
    if (byCategories.length > 0) return byCategories.slice(0, maxItems)

    const all = await xtreamApi.getVodStreams(creds)
    return all.slice(0, maxItems)
  },

  async getVodInfo(creds: XtreamCredentials, vodId: number): Promise<XtreamVODInfo> {
    return fetchJSON(buildUrl(creds, 'get_vod_info', { vod_id: String(vodId) }), { cacheTtlMs: 5 * 60 * 1000 })
  },

  // Series
  async getSeriesCategories(creds: XtreamCredentials): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_series_categories'))
  },

  async getSeries(creds: XtreamCredentials, categoryId?: string): Promise<XtreamSeriesStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_series', params))
  },

  async getSeriesPreviewStreams(creds: XtreamCredentials, maxItems = 500): Promise<XtreamSeriesStream[]> {
    const categories = await xtreamApi.getSeriesCategories(creds).catch(() => [])
    const categoryIds = categories.map((cat) => cat.category_id).filter(Boolean)

    const byCategories = await collectPreviewFromCategories<XtreamSeriesStream, number>({
      categoryIds,
      maxItems,
      fetchByCategory: (categoryId) => xtreamApi.getSeries(creds, categoryId),
      getKey: (stream) => stream.series_id
    })
    if (byCategories.length > 0) return byCategories.slice(0, maxItems)

    const all = await xtreamApi.getSeries(creds)
    return all.slice(0, maxItems)
  },

  async getSeriesInfo(creds: XtreamCredentials, seriesId: number): Promise<XtreamSeriesInfo> {
    return fetchJSON(buildUrl(creds, 'get_series_info', { series_id: String(seriesId) }), { cacheTtlMs: 5 * 60 * 1000 })
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
