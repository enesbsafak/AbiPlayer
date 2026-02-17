const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_REQUEST_TIMEOUT_MS = 12_000
const TMDB_CACHE_TTL_MS = 10 * 60 * 1000

interface TmdbGenre {
  id: number
  name: string
}

interface TmdbCastMember {
  id: number
  name: string
  character?: string
  order?: number
}

interface TmdbCrewMember {
  id: number
  name: string
  job?: string
  department?: string
}

interface TmdbMovieResponse {
  id: number
  title: string
  overview: string
  release_date?: string
  runtime?: number
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  genres?: TmdbGenre[]
  credits?: {
    cast?: TmdbCastMember[]
    crew?: TmdbCrewMember[]
  }
}

interface TmdbTvResponse {
  id: number
  name: string
  overview: string
  first_air_date?: string
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  genres?: TmdbGenre[]
  credits?: {
    cast?: TmdbCastMember[]
    crew?: TmdbCrewMember[]
  }
}

interface TmdbTvSeasonResponse {
  id: number
  name?: string
  overview?: string
  season_number: number
  episodes: Array<{
    id: number
    name?: string
    overview?: string
    episode_number: number
    runtime?: number | null
    still_path?: string | null
    vote_average?: number
    air_date?: string
  }>
}

interface TmdbSearchResponse<T> {
  results: T[]
}

interface TmdbSearchMovieItem {
  id: number
  title: string
  release_date?: string
}

interface TmdbSearchTvItem {
  id: number
  name: string
  first_air_date?: string
}

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

const requestCache = new Map<CacheKey, CachedValue<unknown>>()
const inflightRequests = new Map<CacheKey, Promise<unknown>>()

function toArray<T>(input: T[] | undefined | null): T[] {
  return Array.isArray(input) ? input : []
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

async function fetchTmdb<T>(
  path: string,
  { apiKey, language, query }: { apiKey: string; language?: string; query?: Record<string, string> }
): Promise<T> {
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
  const cached = requestCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T
  }

  const existing = inflightRequests.get(cacheKey)
  if (existing) {
    return existing as Promise<T>
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
        throw new Error(`TMDB request failed (${response.status})`)
      }

      const data = (await response.json()) as T
      requestCache.set(cacheKey, { data, expiresAt: Date.now() + TMDB_CACHE_TTL_MS })
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

function mapMovieDetails(input: TmdbMovieResponse): TmdbMovieDetails {
  const cast = toArray(input.credits?.cast)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 10)
    .map((member) => member.name)
    .filter(Boolean)

  const directors = toArray(input.credits?.crew)
    .filter((member) => member.job === 'Director')
    .map((member) => member.name)
    .filter(Boolean)

  return {
    id: input.id,
    title: input.title || '',
    overview: input.overview || '',
    releaseDate: input.release_date || undefined,
    runtime: typeof input.runtime === 'number' ? input.runtime : undefined,
    rating: typeof input.vote_average === 'number' ? input.vote_average : undefined,
    genres: toArray(input.genres).map((genre) => genre.name).filter(Boolean),
    cast,
    directors,
    posterPath: buildImageUrl(input.poster_path, 'w500'),
    backdropPath: buildImageUrl(input.backdrop_path, 'w780')
  }
}

function mapTvDetails(input: TmdbTvResponse): TmdbTvDetails {
  const cast = toArray(input.credits?.cast)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 12)
    .map((member) => member.name)
    .filter(Boolean)

  const creators = toArray(input.credits?.crew)
    .filter((member) => member.job === 'Creator' || member.job === 'Screenplay' || member.department === 'Writing')
    .map((member) => member.name)
    .filter(Boolean)

  return {
    id: input.id,
    name: input.name || '',
    overview: input.overview || '',
    firstAirDate: input.first_air_date || undefined,
    rating: typeof input.vote_average === 'number' ? input.vote_average : undefined,
    genres: toArray(input.genres).map((genre) => genre.name).filter(Boolean),
    cast,
    creators,
    posterPath: buildImageUrl(input.poster_path, 'w500'),
    backdropPath: buildImageUrl(input.backdrop_path, 'w780')
  }
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
    const search = await fetchTmdb<TmdbSearchResponse<TmdbSearchMovieItem>>('/search/movie', {
      apiKey: key,
      language,
      query: {
        query: name,
        year: normalizeYear(year)
      }
    })

    const targetName = normalizeText(name)
    const targetYear = normalizeYear(year)
    const exact = toArray(search.results).find((item) => {
      const sameName = normalizeText(item.title) === targetName
      const itemYear = normalizeYear(item.release_date)
      return sameName && (!targetYear || targetYear === itemYear)
    })
    movieId = exact?.id ?? search.results?.[0]?.id ?? null
  }

  if (!movieId) return null

  const details = await fetchTmdb<TmdbMovieResponse>(`/movie/${movieId}`, {
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
    const search = await fetchTmdb<TmdbSearchResponse<TmdbSearchTvItem>>('/search/tv', {
      apiKey: key,
      language,
      query: {
        query: name,
        first_air_date_year: normalizeYear(year)
      }
    })

    const targetName = normalizeText(name)
    const targetYear = normalizeYear(year)
    const exact = toArray(search.results).find((item) => {
      const sameName = normalizeText(item.name) === targetName
      const itemYear = normalizeYear(item.first_air_date)
      return sameName && (!targetYear || targetYear === itemYear)
    })

    tvId = exact?.id ?? search.results?.[0]?.id ?? null
  }

  if (!tvId) return null

  const details = await fetchTmdb<TmdbTvResponse>(`/tv/${tvId}`, {
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

  const details = await fetchTmdb<TmdbTvSeasonResponse>(`/tv/${tmdbTvId}/season/${seasonNumber}`, {
    apiKey: key,
    language
  })

  return toArray(details.episodes).map((episode) => ({
    id: episode.id,
    name: episode.name || undefined,
    overview: episode.overview || undefined,
    episodeNumber: episode.episode_number,
    runtime: typeof episode.runtime === 'number' ? episode.runtime : undefined,
    stillPath: buildImageUrl(episode.still_path, 'w500'),
    voteAverage: typeof episode.vote_average === 'number' ? episode.vote_average : undefined,
    airDate: episode.air_date || undefined
  }))
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
