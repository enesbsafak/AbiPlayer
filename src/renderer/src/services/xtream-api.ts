import type {
  XtreamCredentials,
  XtreamAuthResponse,
  XtreamCategory,
  XtreamLiveFormat,
  XtreamLiveStream,
  XtreamVODStream,
  XtreamVODInfo,
  XtreamSeriesStream,
  XtreamSeriesInfo
} from '@/types/xtream'
import type { Channel, Category } from '@/types/playlist'
import { isAdultLabel } from './adult-content'
import { XTREAM_REQUEST_CANCELLED_MESSAGE, XtreamRequestError } from './xtream-errors'
import {
  normalizeXtreamAuthResponse,
  normalizeXtreamCategories,
  normalizeXtreamLiveStreams,
  normalizeXtreamSeries,
  normalizeXtreamSeriesInfo,
  normalizeXtreamVodInfo,
  normalizeXtreamVodStreams,
  parseXtreamTimestamp
} from './xtream-normalize'

export { XtreamRequestError, isXtreamRequestError } from './xtream-errors'
export type { XtreamErrorKind } from './xtream-errors'
export { getAllowedLiveFormats, pickLiveFormat } from './xtream-normalize'

/** Time allowed until the response headers arrive. */
const XTREAM_HEADERS_TIMEOUT_MS = 20_000
/**
 * Header window for whole-catalog calls (no category_id): panels build the
 * complete JSON before sending the first byte, which takes longer than any
 * single-category answer.
 */
const XTREAM_FULL_LIST_HEADERS_TIMEOUT_MS = 45_000
/**
 * Time the body may go without receiving a single byte. There is no fixed
 * total: a full catalog on a slow link keeps going as long as data flows.
 */
const XTREAM_BODY_IDLE_TIMEOUT_MS = 30_000
const XTREAM_DEFAULT_MAX_RETRIES = 2
const XTREAM_RETRY_BASE_DELAY_MS = 500
/** Responses larger than this (in UTF-16 code units) are not kept in the request cache. */
const XTREAM_MAX_CACHEABLE_BODY_CHARS = 2 * 1024 * 1024
const PREVIEW_SCAN_CATEGORY_LIMIT = 12
const XTREAM_DEFAULT_CACHE_TTL_MS = 45_000

/**
 * Strip Xtream credentials from a URL so it is safe to include in logs or
 * user-visible error messages. Handles both the `player_api.php?username=&password=`
 * form and the positional `/live/<user>/<pass>/<id>.m3u8` form.
 */
export function maskCredentialsInUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('username')) parsed.searchParams.set('username', '***')
    if (parsed.searchParams.has('password')) parsed.searchParams.set('password', '***')

    // Positional /live|/movie|/series/<user>/<pass>/<id>.<ext>
    const positionalMatch = parsed.pathname.match(
      /^\/(live|movie|series)\/[^/]+\/[^/]+\/(.+)$/
    )
    if (positionalMatch) {
      parsed.pathname = `/${positionalMatch[1]}/***/***/${positionalMatch[2]}`
    }
    return parsed.toString()
  } catch {
    // Fallback: best-effort regex masking for malformed URLs
    return url
      .replace(/(\b(?:username|password)=)[^&#\s]*/gi, '$1***')
      .replace(/\/(live|movie|series)\/[^/]+\/[^/]+\//gi, '/$1/***/***/')
  }
}

const requestCache = new Map<string, { expiresAt: number; data: unknown }>()
const inflightRequests = new Map<string, Promise<unknown>>()
const CACHE_MAX_SIZE = 500
const CACHE_CLEANUP_INTERVAL_MS = 60_000

let cacheCleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCacheCleanup(): void {
  if (cacheCleanupTimer) return
  cacheCleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of requestCache) {
      if (entry.expiresAt <= now) requestCache.delete(key)
    }
    if (requestCache.size === 0) {
      clearInterval(cacheCleanupTimer!)
      cacheCleanupTimer = null
    }
  }, CACHE_CLEANUP_INTERVAL_MS)
}

function evictCacheIfNeeded(): void {
  if (requestCache.size <= CACHE_MAX_SIZE) return
  const entries = Array.from(requestCache.entries()).toSorted((a, b) => a[1].expiresAt - b[1].expiresAt)
  const toRemove = entries.slice(0, requestCache.size - CACHE_MAX_SIZE)
  for (const [key] of toRemove) requestCache.delete(key)
}

export interface XtreamRequestOptions {
  bypassCache?: boolean
  cacheTtlMs?: number
  signal?: AbortSignal
  /**
   * Retries after a transient failure (network error, timeout, HTTP 408, 429
   * or 5xx). Authentication failures, bad responses and caller aborts are
   * never retried. Defaults to 2.
   */
  maxRetries?: number
  /**
   * Time allowed until the response headers arrive. Defaults to 20 s, and to
   * 45 s for whole-catalog list calls.
   */
  headersTimeoutMs?: number
}

async function runWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  task: (item: T, index: number) => Promise<void>,
  shouldContinue: () => boolean = () => true
): Promise<void> {
  let cursor = 0
  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length || 1))

  const runWorker = async (): Promise<void> => {
    if (!shouldContinue()) return

    const index = cursor
    cursor += 1
    if (index >= items.length) return

    await task(items[index], index)
    await runWorker()
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
}

async function collectPreviewFromCategories<T, K extends string | number>({
  categoryIds,
  maxItems,
  maxCategories = PREVIEW_SCAN_CATEGORY_LIMIT,
  maxConcurrency = 4,
  fetchByCategory,
  getKey,
  signal
}: {
  categoryIds: string[]
  maxItems: number
  maxCategories?: number
  maxConcurrency?: number
  fetchByCategory: (categoryId: string) => Promise<T[]>
  getKey: (item: T) => K
  signal?: AbortSignal
}): Promise<T[]> {
  const result: T[] = []
  const seen = new Set<K>()
  const queue = categoryIds.slice(0, maxCategories)
  let done = false

  await runWithConcurrency(
    queue,
    maxConcurrency,
    async (categoryId) => {
      if (signal?.aborted || done) return
      let items: T[] = []
      try {
        items = await fetchByCategory(categoryId)
      } catch {
        return
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
    },
    () => !done && !signal?.aborted
  )

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

/**
 * Positional stream URL. Username and password are path segments, so a `#`,
 * `/` or `?` in either would otherwise cut the URL short.
 */
function buildStreamUrl(
  creds: XtreamCredentials,
  kind: 'live' | 'movie' | 'series',
  streamId: number,
  extension: string
): string {
  const base = creds.url.replace(/\/+$/, '')
  const user = encodeURIComponent(creds.username)
  const pass = encodeURIComponent(creds.password)
  return `${base}/${kind}/${user}/${pass}/${streamId}.${extension}`
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Read the body as text with a timeout that tracks progress: the clock is
 * reset by every chunk, so a large catalog on a slow but steady link
 * finishes, while a stalled connection fails after XTREAM_BODY_IDLE_TIMEOUT_MS.
 */
async function readBodyText(res: Response, requestSignal: AbortSignal, onIdle: () => void): Promise<string> {
  const reader = res.body?.getReader()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(onIdle, XTREAM_BODY_IDLE_TIMEOUT_MS)
  }
  // A fetch body errors out when its request is aborted; cancelling the
  // reader as well guarantees a pending read settles either way.
  const cancelReader = () => {
    reader?.cancel().catch(() => undefined)
  }
  requestSignal.addEventListener('abort', cancelReader, { once: true })

  armIdleTimer()
  try {
    if (!reader) return await res.text()

    const decoder = new TextDecoder()
    const parts: string[] = []
    const readNext = async (): Promise<void> => {
      const { done, value } = await reader.read()
      if (done) return
      armIdleTimer()
      parts.push(decoder.decode(value, { stream: true }))
      await readNext()
    }
    await readNext()
    // A cancelled reader reports `done`, which must not pass for a full body.
    if (requestSignal.aborted) throw new DOMException('Aborted', 'AbortError')
    parts.push(decoder.decode())
    return parts.join('')
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    requestSignal.removeEventListener('abort', cancelReader)
  }
}

function describeHttpFailure(status: number, sample: string): XtreamRequestError {
  const suffix = sample ? ` (${sample})` : ''
  if (status === 401 || status === 403) {
    return new XtreamRequestError(
      'auth',
      `Kimlik doğrulama başarısız oldu (HTTP ${status}). Kullanıcı adını, şifreyi ve hesap durumunu kontrol edin.${suffix}`,
      { status }
    )
  }
  return new XtreamRequestError('http', `Sunucu hata döndürdü (HTTP ${status})${suffix}`, { status })
}

interface RawJsonResponse {
  data: unknown
  /** Body length in UTF-16 code units. */
  size: number
}

/** One network attempt: headers, body and JSON parse. */
async function requestOnce(
  url: string,
  signal: AbortSignal | undefined,
  headersTimeoutMs: number
): Promise<RawJsonResponse> {
  const controller = new AbortController()
  const state: { timeoutPhase: 'headers' | 'body' | null } = { timeoutPhase: null }
  const headersTimer = setTimeout(() => {
    state.timeoutPhase = 'headers'
    controller.abort()
  }, headersTimeoutMs)
  const abortFromSignal = () => controller.abort()

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromSignal, { once: true })
  }

  try {
    // cache: no-store avoids stale responses from the HTTP cache.
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal, mode: 'cors' })
    clearTimeout(headersTimer)

    // Status first: `fetch` resolves on 4xx/5xx, so the body is only ever a
    // JSON payload once we know the request succeeded.
    if (!res.ok) {
      // Mask credentials in any echoed URL the server might include, so
      // 4xx/5xx errors don't print user:pass into the UI or logs.
      const errorBody = await res.text().catch(() => '')
      const sample = maskCredentialsInUrl(errorBody.slice(0, 160)).replace(/\s+/g, ' ').trim()
      throw describeHttpFailure(res.status, sample)
    }

    const body = await readBodyText(res, controller.signal, () => {
      state.timeoutPhase = 'body'
      controller.abort()
    })

    try {
      return { data: JSON.parse(body), size: body.length }
    } catch {
      const sample = maskCredentialsInUrl(body.slice(0, 200)).replace(/\s+/g, ' ').trim()
      throw new XtreamRequestError(
        'bad-response',
        `Geçersiz sunucu yanıtı. JSON bekleniyordu: ${sample || 'boş gövde'}`
      )
    }
  } catch (error) {
    if (error instanceof XtreamRequestError) throw error
    if (state.timeoutPhase === 'headers') {
      throw new XtreamRequestError(
        'timeout',
        `İstek zaman aşımına uğradı: sunucu ${headersTimeoutMs / 1000} saniye içinde yanıt vermedi`,
        { cause: error }
      )
    }
    if (state.timeoutPhase === 'body') {
      throw new XtreamRequestError(
        'timeout',
        `İstek zaman aşımına uğradı: sunucudan ${XTREAM_BODY_IDLE_TIMEOUT_MS / 1000} saniyedir veri gelmiyor`,
        { cause: error }
      )
    }
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE, { cause: error })
    }
    throw new XtreamRequestError(
      'network',
      'Sunucuya bağlanılamadı. İnternet bağlantısını ve sunucu adresini kontrol edin.',
      { cause: error }
    )
  } finally {
    clearTimeout(headersTimer)
    if (signal) signal.removeEventListener('abort', abortFromSignal)
  }
}

/** Delay before retry number `retry` (1-based): 0.5 s, 1.5 s, 4.5 s ... */
export function xtreamRetryDelayMs(retry: number): number {
  return XTREAM_RETRY_BASE_DELAY_MS * 3 ** (retry - 1)
}

async function requestWithRetry(
  url: string,
  signal: AbortSignal | undefined,
  maxRetries: number,
  headersTimeoutMs: number
): Promise<RawJsonResponse> {
  const attempt = async (retry: number): Promise<RawJsonResponse> => {
    try {
      return await requestOnce(url, signal, headersTimeoutMs)
    } catch (error) {
      if (!(error instanceof XtreamRequestError) || !error.retryable || retry >= maxRetries) throw error
      await sleep(xtreamRetryDelayMs(retry + 1), signal)
      return attempt(retry + 1)
    }
  }
  return attempt(0)
}

async function fetchJSON<T>(
  url: string,
  normalize: (raw: unknown) => T,
  options?: XtreamRequestOptions
): Promise<T> {
  const bypassCache = options?.bypassCache ?? false
  const cacheTtlMs = options?.cacheTtlMs ?? XTREAM_DEFAULT_CACHE_TTL_MS
  const signal = options?.signal
  const maxRetries = Math.max(0, options?.maxRetries ?? XTREAM_DEFAULT_MAX_RETRIES)
  const headersTimeoutMs = options?.headersTimeoutMs ?? XTREAM_HEADERS_TIMEOUT_MS

  if (!bypassCache && cacheTtlMs > 0) {
    const cached = requestCache.get(url)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T
    }

    // Only deduplicate when NEITHER caller owns a cancellation signal. A
    // signal-owning caller controls the lifetime of their own request: if
    // they abort (e.g. React Strict Mode double-mount cleanup), an
    // unrelated second caller must not be stuck on the cancelled promise.
    if (!signal) {
      const existing = inflightRequests.get(url)
      if (existing) return existing as Promise<T>
    }
  }

  const request = (async () => {
    const { data: raw, size } = await requestWithRetry(url, signal, maxRetries, headersTimeoutMs)
    const data = normalize(raw)
    // Full catalogs run to tens of megabytes and are turned into channels
    // right away; a second copy in this cache would only cost memory.
    if (!bypassCache && cacheTtlMs > 0 && size <= XTREAM_MAX_CACHEABLE_BODY_CHARS) {
      requestCache.set(url, { data, expiresAt: Date.now() + cacheTtlMs })
      evictCacheIfNeeded()
      ensureCacheCleanup()
    }
    return data
  })()

  // Only publish the request to the shared in-flight map when no caller-owned
  // signal is attached. Requests tied to an external AbortSignal are
  // effectively "owned" by that caller and must not be piggy-backed on — a
  // cancellation would otherwise propagate to unrelated consumers (see
  // React Strict Mode double-mount races).
  const shareable = !signal && !bypassCache && cacheTtlMs > 0
  if (shareable) {
    inflightRequests.set(url, request as Promise<unknown>)
  }

  try {
    return await request
  } finally {
    if (shareable) inflightRequests.delete(url)
  }
}

/** Whole-catalog calls get the longer header window unless the caller sets one. */
function listOptions(categoryId: string | undefined, options?: XtreamRequestOptions): XtreamRequestOptions | undefined {
  if (categoryId || options?.headersTimeoutMs !== undefined) return options
  return { ...options, headersTimeoutMs: XTREAM_FULL_LIST_HEADERS_TIMEOUT_MS }
}

/** Options for converting Xtream live streams into channels. */
export interface XtreamLiveChannelOptions {
  /** Extension of the live stream URL. Defaults to 'm3u8'. */
  liveFormat?: XtreamLiveFormat
}

/**
 * Catalog timestamps (unix seconds) keyed by the channel id the converters
 * produce: `added` for live and VOD, `last_modified` for series. Entries the
 * panel sent no timestamp for are left out. Kept outside `Channel` so the
 * playlist type does not change.
 */
export function collectXtreamTimestamps(
  streams: Array<XtreamLiveStream | XtreamVODStream | XtreamSeriesStream>,
  sourceId: string,
  type: 'live' | 'vod' | 'series'
): Map<string, number> {
  const result = new Map<string, number>()
  for (const stream of streams) {
    const id = 'series_id' in stream ? stream.series_id : stream.stream_id
    const value = 'last_modified' in stream ? stream.last_modified : stream.added
    const timestamp = parseXtreamTimestamp(value)
    if (timestamp !== null) result.set(`${sourceId}_${type}_${id}`, timestamp)
  }
  return result
}

export const xtreamApi = {
  async authenticate(creds: XtreamCredentials, options?: XtreamRequestOptions): Promise<XtreamAuthResponse> {
    const url = buildUrl(creds, '')
    return fetchJSON(url, normalizeXtreamAuthResponse, { ...options, bypassCache: true })
  },

  // Live TV
  async getLiveCategories(creds: XtreamCredentials, options?: XtreamRequestOptions): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_live_categories'), normalizeXtreamCategories, options)
  },

  async getLiveStreams(
    creds: XtreamCredentials,
    categoryId?: string,
    options?: XtreamRequestOptions
  ): Promise<XtreamLiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_live_streams', params), normalizeXtreamLiveStreams, listOptions(categoryId, options))
  },

  async getLivePreviewStreams(
    creds: XtreamCredentials,
    maxItems = 500,
    options?: XtreamRequestOptions
  ): Promise<XtreamLiveStream[]> {
    const categories = await xtreamApi.getLiveCategories(creds, options).catch(() => [])
    const categoryIds = categories.flatMap((cat) => (cat.category_id ? [cat.category_id] : []))

    const byCategories = await collectPreviewFromCategories<XtreamLiveStream, number>({
      categoryIds,
      maxItems,
      fetchByCategory: (categoryId) => xtreamApi.getLiveStreams(creds, categoryId, options),
      getKey: (stream) => stream.stream_id,
      signal: options?.signal
    })
    if (byCategories.length > 0) return byCategories.slice(0, maxItems)

    const all = await xtreamApi.getLiveStreams(creds, undefined, options)
    return all.slice(0, maxItems)
  },

  // VOD
  async getVodCategories(creds: XtreamCredentials, options?: XtreamRequestOptions): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_vod_categories'), normalizeXtreamCategories, options)
  },

  async getVodStreams(
    creds: XtreamCredentials,
    categoryId?: string,
    options?: XtreamRequestOptions
  ): Promise<XtreamVODStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_vod_streams', params), normalizeXtreamVodStreams, listOptions(categoryId, options))
  },

  async getVodPreviewStreams(
    creds: XtreamCredentials,
    maxItems = 500,
    options?: XtreamRequestOptions
  ): Promise<XtreamVODStream[]> {
    const categories = await xtreamApi.getVodCategories(creds, options).catch(() => [])
    const categoryIds = categories.flatMap((cat) => (cat.category_id ? [cat.category_id] : []))

    const byCategories = await collectPreviewFromCategories<XtreamVODStream, number>({
      categoryIds,
      maxItems,
      fetchByCategory: (categoryId) => xtreamApi.getVodStreams(creds, categoryId, options),
      getKey: (stream) => stream.stream_id,
      signal: options?.signal
    })
    if (byCategories.length > 0) return byCategories.slice(0, maxItems)

    const all = await xtreamApi.getVodStreams(creds, undefined, options)
    return all.slice(0, maxItems)
  },

  async getVodInfo(
    creds: XtreamCredentials,
    vodId: number,
    options?: XtreamRequestOptions
  ): Promise<XtreamVODInfo> {
    return fetchJSON(buildUrl(creds, 'get_vod_info', { vod_id: String(vodId) }), normalizeXtreamVodInfo, {
      ...options,
      cacheTtlMs: 5 * 60 * 1000
    })
  },

  // Series
  async getSeriesCategories(creds: XtreamCredentials, options?: XtreamRequestOptions): Promise<XtreamCategory[]> {
    return fetchJSON(buildUrl(creds, 'get_series_categories'), normalizeXtreamCategories, options)
  },

  async getSeries(
    creds: XtreamCredentials,
    categoryId?: string,
    options?: XtreamRequestOptions
  ): Promise<XtreamSeriesStream[]> {
    const params = categoryId ? { category_id: categoryId } : undefined
    return fetchJSON(buildUrl(creds, 'get_series', params), normalizeXtreamSeries, listOptions(categoryId, options))
  },

  async getSeriesPreviewStreams(
    creds: XtreamCredentials,
    maxItems = 500,
    options?: XtreamRequestOptions
  ): Promise<XtreamSeriesStream[]> {
    const categories = await xtreamApi.getSeriesCategories(creds, options).catch(() => [])
    const categoryIds = categories.flatMap((cat) => (cat.category_id ? [cat.category_id] : []))

    const byCategories = await collectPreviewFromCategories<XtreamSeriesStream, number>({
      categoryIds,
      maxItems,
      fetchByCategory: (categoryId) => xtreamApi.getSeries(creds, categoryId, options),
      getKey: (stream) => stream.series_id,
      signal: options?.signal
    })
    if (byCategories.length > 0) return byCategories.slice(0, maxItems)

    const all = await xtreamApi.getSeries(creds, undefined, options)
    return all.slice(0, maxItems)
  },

  async getSeriesInfo(
    creds: XtreamCredentials,
    seriesId: number,
    options?: XtreamRequestOptions
  ): Promise<XtreamSeriesInfo> {
    return fetchJSON(
      buildUrl(creds, 'get_series_info', { series_id: String(seriesId) }),
      normalizeXtreamSeriesInfo,
      { ...options, cacheTtlMs: 5 * 60 * 1000 }
    )
  },

  // URL builders
  buildLiveUrl(creds: XtreamCredentials, streamId: number, extension: XtreamLiveFormat | string = 'm3u8'): string {
    return buildStreamUrl(creds, 'live', streamId, extension)
  },

  buildVodUrl(creds: XtreamCredentials, streamId: number, extension: string): string {
    return buildStreamUrl(creds, 'movie', streamId, extension)
  },

  buildSeriesUrl(creds: XtreamCredentials, streamId: number, extension: string): string {
    return buildStreamUrl(creds, 'series', streamId, extension)
  },

  buildEpgUrl(creds: XtreamCredentials): string {
    const base = creds.url.replace(/\/+$/, '')
    return `${base}/xmltv.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`
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

  liveStreamsToChannels(
    streams: XtreamLiveStream[],
    creds: XtreamCredentials,
    sourceId: string,
    options?: XtreamLiveChannelOptions
  ): Channel[] {
    const liveFormat = options?.liveFormat ?? 'm3u8'
    return streams.map((s) => ({
      id: `${sourceId}_live_${s.stream_id}`,
      name: s.name,
      logo: s.stream_icon || undefined,
      streamUrl: xtreamApi.buildLiveUrl(creds, s.stream_id, liveFormat),
      streamId: s.stream_id,
      sourceId,
      categoryId: s.category_id ? `${sourceId}_live_${s.category_id}` : undefined,
      epgChannelId: s.epg_channel_id || undefined,
      type: 'live' as const,
      // Plenty of providers never populate is_adult, so fall back to the name.
      // The category is checked separately at view time (adultCategoryIds),
      // because Xtream streams carry only a category id, not its name.
      isAdult: s.is_adult || isAdultLabel(s.name),
      tvArchive: s.tv_archive,
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
      isAdult: s.is_adult || isAdultLabel(s.name),
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
      // XtreamSeriesStream carries no is_adult field at all — name only.
      isAdult: isAdultLabel(s.name),
      rating: s.rating,
      plot: s.plot,
      cast: s.cast,
      director: s.director,
      genre: s.genre,
      releaseDate: s.release_date,
      coverUrl: s.cover,
      backdropUrl: s.backdrop_path[0]
    }))
  }
}
