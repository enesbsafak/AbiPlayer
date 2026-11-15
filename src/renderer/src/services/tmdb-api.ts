import { cleanTitleForTmdbSearch, pickConfidentTmdbMatch, type TmdbMatchCandidate } from './tmdb-match'
import { errors } from '@/strings/errors'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_REQUEST_TIMEOUT_MS = 12_000
const TMDB_CACHE_TTL_MS = 10 * 60 * 1000

export interface TmdbMovieDetails {
  id: number
  title: string
  overview: string
  releaseDate?: string
  runtime?: number
  rating?: number
  genres: string[]
  cast: string[]
  directors: string[]
  posterPath?: string
  backdropPath?: string
}

export interface TmdbTvDetails {
  id: number
  name: string
  overview: string
  firstAirDate?: string
  rating?: number
  genres: string[]
  cast: string[]
  creators: string[]
  posterPath?: string
  backdropPath?: string
}

export interface TmdbEpisodeDetails {
  id: number
  name?: string
  overview?: string
  episodeNumber: number
  runtime?: number
  stillPath?: string
  voteAverage?: number
  airDate?: string
}

interface CachedValue<T> {
  data: T
  expiresAt: number
}

type CacheKey = string

// LRU-bounded cache. TMDB responses are small JSON blobs, but long sessions that
// browse many titles/series can otherwise balloon memory. We cap the number of
// entries and evict the oldest (insertion order) when full.
const TMDB_CACHE_MAX_ENTRIES = 300

const requestCache = new Map<CacheKey, CachedValue<unknown>>()
const inflightRequests = new Map<CacheKey, Promise<unknown>>()

function tmdbCacheSet<T>(key: CacheKey, value: CachedValue<T>): void {
  // Refresh recency by re-inserting.
  if (requestCache.has(key)) requestCache.delete(key)
  requestCache.set(key, value as CachedValue<unknown>)

  if (requestCache.size > TMDB_CACHE_MAX_ENTRIES) {
    // First key is the least recently used (Map preserves insertion order).
    const toEvict = requestCache.size - TMDB_CACHE_MAX_ENTRIES
    let evicted = 0
    for (const oldestKey of requestCache.keys()) {
      if (evicted >= toEvict) break
      requestCache.delete(oldestKey)
      evicted += 1
    }
  }
}

function tmdbCacheGet<T>(key: CacheKey): CachedValue<T> | undefined {
  const entry = requestCache.get(key) as CachedValue<T> | undefined
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    requestCache.delete(key)
    return undefined
  }
  // Refresh recency on hit.
  requestCache.delete(key)
  requestCache.set(key, entry as CachedValue<unknown>)
  return entry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function invalidTmdbResponse(): Error {
  return new Error(errors.tmdb.badResponse)
}

/** A details response is only usable when it is an object with a numeric id. */
function requireTmdbObject(data: unknown): Record<string, unknown> & { id: number } {
  if (!isRecord(data) || typeof data.id !== 'number') throw invalidTmdbResponse()
  return data as Record<string, unknown> & { id: number }
}

/** Search results as match candidates; malformed entries are skipped. */
function readSearchCandidates(data: unknown, kind: 'movie' | 'tv'): TmdbMatchCandidate[] {
  if (!isRecord(data) || !Array.isArray(data.results)) throw invalidTmdbResponse()
  return data.results.flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== 'number') return []
    return [
      kind === 'movie'
        ? {
            id: item.id,
            title: optionalString(item.title),
            originalTitle: optionalString(item.original_title),
            date: optionalString(item.release_date)
          }
        : {
            id: item.id,
            title: optionalString(item.name),
            originalTitle: optionalString(item.original_name),
            date: optionalString(item.first_air_date)
          }
    ]
  })
}

function normalizeText(value: string | undefined | null): string {
  return (value || '').trim().toLowerCase()
}

function normalizeYear(value: string | number | undefined | null): string {
  if (!value) return ''
  const str = String(value)
  const match = str.match(/\d{4}/)
  return match ? match[0] : ''
}

function parseTmdbId(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value

  const text = String(value).trim()
  if (!text) return null
  if (text.toLowerCase().startsWith('tt')) return null

  const match = text.match(/\d+/)
  if (!match) return null
  const parsed = Number.parseInt(match[0], 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function isBearerToken(apiKey: string): boolean {
  return apiKey.trim().startsWith('eyJ')
}

function normalizeApiKey(apiKey?: string | null): string | null {
  const key = apiKey?.trim()
  return key ? key : null
}

function buildImageUrl(path: string | null | undefined, width: 'w500' | 'w780' = 'w500'): string | undefined {
  if (!path) return undefined
  return `https://image.tmdb.org/t/p/${width}${path}`
}

/** Raw JSON from TMDB; callers validate it before use. */
async function fetchTmdb(
  path: string,
  { apiKey, language, query }: { apiKey: string; language?: string; query?: Record<string, string> }
): Promise<unknown> {
  const url = new URL(`${TMDB_BASE_URL}${path}`)
  if (!isBearerToken(apiKey)) {
    url.searchParams.set('api_key', apiKey)
  }
  if (language) {
    url.searchParams.set('language', language)
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (!value) continue
      url.searchParams.set(key, value)
    }
  }

  const cacheKey = `${url.toString()}|auth:${apiKey}`
  const cached = tmdbCacheGet<unknown>(cacheKey)
  if (cached) {
    return cached.data
  }

  const existing = inflightRequests.get(cacheKey)
  if (existing) {
    return existing
  }

  const request = (async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), TMDB_REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: isBearerToken(apiKey)
          ? {
              Authorization: `Bearer ${apiKey}`,
              Accept: 'application/json'
            }
          : undefined
      })

      if (!response.ok) {
        throw new Error(errors.tmdb.requestFailed(response.status))
      }

      const data: unknown = await response.json().catch(() => {
        throw invalidTmdbResponse()
      })
      tmdbCacheSet<unknown>(cacheKey, { data, expiresAt: Date.now() + TMDB_CACHE_TTL_MS })
      return data
    } finally {
      window.clearTimeout(timer)
    }
  })()

  inflightRequests.set(cacheKey, request)
  try {
    return await request
  } finally {
    inflightRequests.delete(cacheKey)
  }
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function nameOf(record: Record<string, unknown>): string[] {
  return typeof record.name === 'string' && record.name ? [record.name] : []
}

function castNames(credits: unknown, limit: number): string[] {
  const cast = isRecord(credits) ? recordsOf(credits.cast) : []
  const order = (member: Record<string, unknown>) => (typeof member.order === 'number' ? member.order : 999)
  return cast
    .sort((a, b) => order(a) - order(b))
    .slice(0, limit)
    .flatMap(nameOf)
}

function crewNames(credits: unknown, include: (member: Record<string, unknown>) => boolean): string[] {
  const crew = isRecord(credits) ? recordsOf(credits.crew) : []
  return crew.flatMap((member) => (include(member) ? nameOf(member) : []))
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function imagePath(value: unknown, width: 'w500' | 'w780'): string | undefined {
  return buildImageUrl(typeof value === 'string' ? value : undefined, width)
}

function mapMovieDetails(data: unknown): TmdbMovieDetails {
  const input = requireTmdbObject(data)
  return {
    id: input.id,
    title: optionalString(input.title) || '',
    overview: optionalString(input.overview) || '',
    releaseDate: optionalString(input.release_date) || undefined,
    runtime: optionalNumber(input.runtime),
    rating: optionalNumber(input.vote_average),
    genres: recordsOf(input.genres).flatMap(nameOf),
    cast: castNames(input.credits, 10),
    directors: crewNames(input.credits, (member) => member.job === 'Director'),
    posterPath: imagePath(input.poster_path, 'w500'),
    backdropPath: imagePath(input.backdrop_path, 'w780')
  }
}

function mapTvDetails(data: unknown): TmdbTvDetails {
  const input = requireTmdbObject(data)
  return {
    id: input.id,
    name: optionalString(input.name) || '',
    overview: optionalString(input.overview) || '',
    firstAirDate: optionalString(input.first_air_date) || undefined,
    rating: optionalNumber(input.vote_average),
    genres: recordsOf(input.genres).flatMap(nameOf),
    cast: castNames(input.credits, 12),
    creators: crewNames(
      input.credits,
      (member) => member.job === 'Creator' || member.job === 'Screenplay' || member.department === 'Writing'
    ),
    posterPath: imagePath(input.poster_path, 'w500'),
    backdropPath: imagePath(input.backdrop_path, 'w780')
  }
}

/**
 * Search TMDB for a provider name and return the id of a confident match, or
 * null. The name is cleaned first ("TR: Film (2019) 4K" searches "Film" with
 * year 2019); a result that does not match the cleaned title is never taken,
 * so the provider's own plot and artwork stay in place.
 */
async function searchConfidentTmdbId(
  kind: 'movie' | 'tv',
  name: string,
  year: string | number | undefined,
  apiKey: string,
  language: string | undefined
): Promise<number | null> {
  const cleaned = cleanTitleForTmdbSearch(name)
  if (!cleaned.title) return null
  const targetYear = normalizeYear(year) || cleaned.year

  const search = await fetchTmdb(kind === 'movie' ? '/search/movie' : '/search/tv', {
    apiKey,
    language,
    query:
      kind === 'movie'
        ? { query: cleaned.title, year: targetYear }
        : { query: cleaned.title, first_air_date_year: targetYear }
  })

  const match = pickConfidentTmdbMatch(readSearchCandidates(search, kind), cleaned.title, targetYear || null)
  return match?.id ?? null
}

export async function resolveTmdbMovieDetails({
  apiKey,
  language,
  tmdbId,
  name,
  year
}: {
  apiKey?: string | null
  language?: string
  tmdbId?: string | number | null
  name?: string
  year?: string | number
}): Promise<TmdbMovieDetails | null> {
  const key = normalizeApiKey(apiKey)
  if (!key) return null

  let movieId = parseTmdbId(tmdbId)
  if (!movieId && name) {
    movieId = await searchConfidentTmdbId('movie', name, year, key, language)
  }

  if (!movieId) return null

  const details = await fetchTmdb(`/movie/${movieId}`, {
    apiKey: key,
    language,
    query: {
      append_to_response: 'credits'
    }
  })
  return mapMovieDetails(details)
}

export async function resolveTmdbTvDetails({
  apiKey,
  language,
  tmdbId,
  name,
  year
}: {
  apiKey?: string | null
  language?: string
  tmdbId?: string | number | null
  name?: string
  year?: string | number
}): Promise<TmdbTvDetails | null> {
  const key = normalizeApiKey(apiKey)
  if (!key) return null

  let tvId = parseTmdbId(tmdbId)
  if (!tvId && name) {
    tvId = await searchConfidentTmdbId('tv', name, year, key, language)
  }

  if (!tvId) return null

  const details = await fetchTmdb(`/tv/${tvId}`, {
    apiKey: key,
    language,
    query: {
      append_to_response: 'credits'
    }
  })
  return mapTvDetails(details)
}

export async function resolveTmdbSeasonEpisodes({
  apiKey,
  language,
  tmdbTvId,
  seasonNumber
}: {
  apiKey?: string | null
  language?: string
  tmdbTvId: number | null
  seasonNumber: number
}): Promise<TmdbEpisodeDetails[]> {
  const key = normalizeApiKey(apiKey)
  if (!key || !tmdbTvId || !Number.isFinite(seasonNumber) || seasonNumber < 0) return []

  const details = await fetchTmdb(`/tv/${tmdbTvId}/season/${seasonNumber}`, {
    apiKey: key,
    language
  })
  if (!isRecord(details)) throw invalidTmdbResponse()

  return recordsOf(details.episodes).flatMap((episode) => {
    if (typeof episode.id !== 'number' || typeof episode.episode_number !== 'number') return []
    return [{
      id: episode.id,
      name: optionalString(episode.name) || undefined,
      overview: optionalString(episode.overview) || undefined,
      episodeNumber: episode.episode_number,
      runtime: optionalNumber(episode.runtime),
      stillPath: imagePath(episode.still_path, 'w500'),
      voteAverage: optionalNumber(episode.vote_average),
      airDate: optionalString(episode.air_date) || undefined
    }]
  })
}

export function resolveTmdbLanguage(language: string | undefined): string {
  const normalized = normalizeText(language)
  if (!normalized) return 'tr-TR'
  if (normalized === 'tr' || normalized === 'tr-tr') return 'tr-TR'
  return 'tr-TR'
}

export function resolveTmdbApiKey(
  settingsApiKey?: string | null,
  envApiKey?: string | null
): string | null {
  return normalizeApiKey(settingsApiKey) ?? normalizeApiKey(envApiKey)
}
