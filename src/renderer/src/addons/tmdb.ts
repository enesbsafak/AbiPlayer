import { XTREAM_REQUEST_CANCELLED_MESSAGE, XtreamRequestError, type XtreamErrorKind } from '@/services/xtream-errors'
import type { AddonCatalogSummary, AddonManifestSummary } from '@/types/addon'
import type { AddonContentType } from '../../../shared/playback'
import { errors } from '@/strings/errors'
import { strings } from '@/strings'
import type { AddonCatalogPage, AddonMeta, AddonMetaPreview, AddonSeason, AddonVideo } from './client'
import { readCapped } from './request'
import { isRecord, readArray, readText } from './validate'

/*
 * The built-in TMDB catalogue: films and series from TMDB's lists, asked
 * with the user's own TMDB key, in Turkish (`tr-TR`, region `TR` where an
 * endpoint takes one), mapped onto the shapes an add-on's answers take
 * (client.ts), so the pager, the detail mapping and the playback targets
 * work on it unchanged. Stream add-ons are asked by IMDb id, which TMDB
 * gives in `external_ids`.
 *
 * The key goes the way services/tmdb-api.ts sends it: a v4 token in the
 * Authorization header, a v3 key as the `api_key` query parameter. The URL
 * therefore never reaches an error, a log or the cache's keys as text;
 * every failure is one of the sentences below, with the status at most.
 * Adult titles are never asked for (`include_adult=false`) and dropped if
 * one comes anyway.
 */

export const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const TMDB_HOST = 'api.themoviedb.org'
const LANGUAGE = 'tr-TR'
const REGION = 'TR'

/** Entries on one TMDB list page. */
export const TMDB_PAGE_SIZE = 20
/** TMDB refuses pages past this one. */
export const TMDB_MAX_PAGE = 500

const REQUEST_TIMEOUT_MS = 15_000
const MAX_BYTES = 2 * 1024 * 1024
/** A 429 is retried once; a `Retry-After` longer than this is not waited for. */
const MAX_RETRY_WAIT_MS = 10_000
const DEFAULT_RETRY_WAIT_MS = 2_000
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

const MAX_NAME_LENGTH = 300
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_SHORT_TEXT_LENGTH = 120
const MAX_PEOPLE = 12
const MAX_GENRES = 20
const MAX_SEASONS = 100
const MAX_EPISODES = 500

/** The source's manifest id: what `AddonManifestSummary.id` says for the built-in catalogue. */
export const TMDB_CATALOG_MANIFEST_ID = 'builtin.tmdb'
/** Meta ids of the built-in catalogue: `tmdb:<TMDB id>`. */
export const TMDB_META_PREFIX = 'tmdb:'

/**
 * A failed TMDB request. `message` is one of the sentences of
 * `errors.tmdb`, which name TMDB and what to do; `origin` tells the add-on
 * messages (messages.ts) to show it as it is.
 */
export class TmdbRequestError extends XtreamRequestError {
  readonly origin = 'tmdb' as const

  constructor(kind: XtreamErrorKind, message: string, options: { status?: number } = {}) {
    super(kind, message, { ...options, host: TMDB_HOST })
  }
}

// ---------------------------------------------------------------------------
// Requests

export interface TmdbRequestOptions {
  apiKey: string
  signal?: AbortSignal
  /** Tests replace the network. */
  fetchImpl?: typeof fetch
  /** The pause before the one retry after a 429; tests replace it. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Answers that rarely change (details, seasons, genres) are kept for a while. */
  cache?: boolean
}

type Query = Record<string, string | number | undefined>

function isBearerToken(apiKey: string): boolean {
  return apiKey.startsWith('eyJ')
}

function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * How long a 429 asks to wait, in ms: `Retry-After` as seconds or as a date;
 * a default without one. Null when it asks for longer than the app waits.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  let wait = DEFAULT_RETRY_WAIT_MS
  const value = header?.trim()
  if (value) {
    if (/^\d+$/.test(value)) wait = Number(value) * 1000
    else {
      const at = Date.parse(value)
      if (Number.isFinite(at)) wait = Math.max(0, at - now)
    }
  }
  return wait > MAX_RETRY_WAIT_MS ? null : wait
}

function failureFor(status: number): TmdbRequestError {
  if (status === 401) return new TmdbRequestError('auth', errors.tmdb.keyRefused, { status })
  if (status === 429) return new TmdbRequestError('http', errors.tmdb.rateLimited, { status })
  if (status === 404) return new TmdbRequestError('http', errors.tmdb.notFound, { status })
  return new TmdbRequestError('http', errors.tmdb.requestFailed(status), { status })
}

interface CachedAnswer {
  data: unknown
  expiresAt: number
}

const answers = new Map<string, CachedAnswer>()

function cached(key: string): unknown {
  const entry = answers.get(key)
  if (!entry) return undefined
  answers.delete(key)
  if (entry.expiresAt <= Date.now()) return undefined
  answers.set(key, entry)
  return entry.data
}

function remember(key: string, data: unknown): void {
  answers.delete(key)
  answers.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  while (answers.size > CACHE_MAX_ENTRIES) {
    const oldest = answers.keys().next().value
    if (oldest === undefined) break
    answers.delete(oldest)
  }
}

/** Tests: forget every kept answer. */
export function forgetTmdbAnswers(): void {
  answers.clear()
}

/**
 * GETs one TMDB path and parses its JSON. A 429 is retried once after the
 * wait `Retry-After` asks for (when it is short); every failure is a
 * `TmdbRequestError` without the URL, a cancel an `aborted` request error.
 */
export async function tmdbRequest(path: string, query: Query, options: TmdbRequestOptions): Promise<unknown> {
  const url = new URL(`${TMDB_API_BASE}${path}`)
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value))
  }
  // The cache key holds the key's place, never the key in a URL: two keys
  // keep apart, and a key changed in Ayarlar is not answered from the old.
  const cacheKey = options.cache ? `${options.apiKey}\n${url.pathname}${url.search}` : null
  if (cacheKey) {
    const hit = cached(cacheKey)
    if (hit !== undefined) return hit
  }
  const bearer = isBearerToken(options.apiKey)
  if (!bearer) url.searchParams.set('api_key', options.apiKey)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (bearer) headers.Authorization = `Bearer ${options.apiKey}`

  const doFetch = options.fetchImpl ?? fetch
  const wait = options.wait ?? defaultWait
  const { signal } = options

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    try {
      let res: Response
      try {
        res = await doFetch(url.toString(), {
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
          headers,
          signal: controller.signal
        })
      } catch {
        throw new TmdbRequestError('network', errors.tmdb.offline)
      }
      if (res.status === 429 && attempt === 0) {
        const pause = retryAfterMs(res.headers.get('retry-after'))
        // The body is not wanted; its cancel is not waited for.
        void res.body?.cancel().catch(() => undefined)
        if (pause === null) throw failureFor(429)
        clearTimeout(timer)
        await wait(pause, signal)
        continue
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined)
        throw failureFor(res.status)
      }
      let body: string
      try {
        body = await readCapped(res, MAX_BYTES, TMDB_HOST)
      } catch {
        throw new TmdbRequestError('bad-response', errors.tmdb.badResponse)
      }
      let data: unknown
      try {
        data = JSON.parse(body) as unknown
      } catch {
        throw new TmdbRequestError('bad-response', errors.tmdb.badResponse)
      }
      if (cacheKey) remember(cacheKey, data)
      return data
    } catch (error) {
      if (signal?.aborted) throw new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE)
      if (timedOut) throw new TmdbRequestError('timeout', errors.tmdb.timeout)
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

// ---------------------------------------------------------------------------
// Answers

function imageUrl(path: unknown, size: 'w185' | 'w300' | 'w342' | 'w500' | 'w780'): string | null {
  return typeof path === 'string' && /^\/[\w.-]+$/.test(path) ? `${TMDB_IMAGE_BASE}/${size}${path}` : null
}

function readDate(value: unknown): string | null {
  const text = readText(value, 10)
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function readTmdbId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/** `vote_average` as the cards show a rating ("7.4"); none for a title without votes. */
function readVote(record: Record<string, unknown>): string | null {
  const average = record.vote_average
  const count = record.vote_count
  if (typeof average !== 'number' || !Number.isFinite(average) || average <= 0) return null
  if (typeof count === 'number' && count <= 0) return null
  return average.toFixed(1)
}

/** An IMDb title id, or null. */
export function readImdbId(value: unknown): string | null {
  return typeof value === 'string' && /^tt\d{1,12}$/.test(value) ? value : null
}

export function tmdbMetaId(id: number): string {
  return `${TMDB_META_PREFIX}${id}`
}

/** The TMDB id in a meta id of the built-in catalogue, or null. */
export function parseTmdbMetaId(metaId: string): number | null {
  const match = /^tmdb:(\d{1,12})$/.exec(metaId)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function namesOf(value: unknown, max: number): string[] {
  const names: string[] = []
  for (const entry of readArray(value, max * 4)) {
    if (names.length >= max) break
    const name = isRecord(entry) ? readText(entry.name, MAX_SHORT_TEXT_LENGTH) : null
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** A list entry (`/movie/popular`, `/search/tv`, ...) as a catalogue entry; adult ones are dropped. */
function readListEntry(raw: unknown, type: AddonContentType): AddonMetaPreview | null {
  if (!isRecord(raw) || raw.adult === true) return null
  const id = readTmdbId(raw.id)
  const name = readText(type === 'movie' ? raw.title : raw.name, MAX_NAME_LENGTH)
  if (!id || !name) return null
  const date = readDate(type === 'movie' ? raw.release_date : raw.first_air_date)
  const year = date?.slice(0, 4) ?? null
  return {
    id: tmdbMetaId(id),
    type,
    name,
    poster: imageUrl(raw.poster_path, 'w342'),
    background: imageUrl(raw.backdrop_path, 'w780'),
    year,
    releaseInfo: year,
    rating: readVote(raw),
    description: readText(raw.overview, MAX_DESCRIPTION_LENGTH, { multiline: true }),
    genres: []
  }
}

/**
 * One TMDB list page as a catalogue page. `received` is always a full page
 * (what the next `skip` advances by: TMDB pages by number, not by offset),
 * and `ended` says when there is no page after it.
 */
export function parseTmdbListPage(data: unknown, type: AddonContentType, page: number): AddonCatalogPage | null {
  if (!isRecord(data) || !Array.isArray(data.results)) return null
  const metas: AddonMetaPreview[] = []
  const seen = new Set<string>()
  for (const raw of readArray(data.results, TMDB_PAGE_SIZE * 2)) {
    const meta = readListEntry(raw, type)
    if (!meta || seen.has(meta.id)) continue
    seen.add(meta.id)
    metas.push(meta)
  }
  const totalPages = typeof data.total_pages === 'number' && Number.isFinite(data.total_pages) ? data.total_pages : page
  const total = typeof data.total_results === 'number' && Number.isFinite(data.total_results) ? data.total_results : undefined
  return {
    metas,
    received: TMDB_PAGE_SIZE,
    ended: data.results.length === 0 || page >= Math.min(totalPages, TMDB_MAX_PAGE),
    ...(total !== undefined ? { total: Math.max(0, Math.round(total)) } : {})
  }
}

/**
 * The overview in Turkish, else in the title's original language (from the
 * `translations` appended to the answer), else in English.
 */
function overviewOf(record: Record<string, unknown>): string | null {
  const own = readText(record.overview, MAX_DESCRIPTION_LENGTH, { multiline: true })
  if (own) return own
  const translations = isRecord(record.translations) ? readArray(record.translations.translations, 400) : []
  const overviewIn = (language: unknown): string | null => {
    if (typeof language !== 'string') return null
    for (const entry of translations) {
      if (!isRecord(entry) || entry.iso_639_1 !== language || !isRecord(entry.data)) continue
      const text = readText(entry.data.overview, MAX_DESCRIPTION_LENGTH, { multiline: true })
      if (text) return text
    }
    return null
  }
  return overviewIn(record.original_language) ?? overviewIn('en')
}

function castOf(record: Record<string, unknown>): string[] {
  const credits = isRecord(record.credits) ? record.credits : {}
  const cast = readArray(credits.cast, 200)
    .filter(isRecord)
    .sort((a, b) => (typeof a.order === 'number' ? a.order : 999) - (typeof b.order === 'number' ? b.order : 999))
  return namesOf(cast, MAX_PEOPLE)
}

function imdbIdOf(record: Record<string, unknown>): string | null {
  return readImdbId(isRecord(record.external_ids) ? record.external_ids.imdb_id : undefined) ?? readImdbId(record.imdb_id)
}

/** A film's details (with `credits,external_ids,translations` appended) as a meta. */
export function parseTmdbMovie(data: unknown): AddonMeta | null {
  if (!isRecord(data)) return null
  const id = readTmdbId(data.id)
  const name = readText(data.title, MAX_NAME_LENGTH) ?? readText(data.original_title, MAX_NAME_LENGTH)
  if (!id || !name) return null
  const date = readDate(data.release_date)
  const credits = isRecord(data.credits) ? data.credits : {}
  const directors = readArray(credits.crew, 400).filter((member) => isRecord(member) && member.job === 'Director')
  const runtime = typeof data.runtime === 'number' && data.runtime > 0 ? Math.round(data.runtime) : null
  return {
    id: tmdbMetaId(id),
    type: 'movie',
    name,
    poster: imageUrl(data.poster_path, 'w500'),
    background: imageUrl(data.backdrop_path, 'w780'),
    year: date?.slice(0, 4) ?? null,
    releaseInfo: date,
    rating: readVote(data),
    description: overviewOf(data),
    genres: namesOf(data.genres, MAX_GENRES),
    cast: castOf(data),
    director: namesOf(directors, MAX_PEOPLE),
    runtime: runtime ? strings.catalog.detail.minutes(runtime) : null,
    videos: [],
    streamId: imdbIdOf(data)
  }
}

/** A series' details (with `credits,external_ids,translations` appended) as a meta whose seasons load one by one. */
export function parseTmdbSeries(data: unknown): AddonMeta | null {
  if (!isRecord(data)) return null
  const id = readTmdbId(data.id)
  const name = readText(data.name, MAX_NAME_LENGTH) ?? readText(data.original_name, MAX_NAME_LENGTH)
  if (!id || !name) return null
  const date = readDate(data.first_air_date)
  const seasons: AddonSeason[] = []
  for (const raw of readArray(data.seasons, MAX_SEASONS)) {
    if (!isRecord(raw)) continue
    const season = typeof raw.season_number === 'number' && Number.isSafeInteger(raw.season_number) ? raw.season_number : null
    const episodeCount = typeof raw.episode_count === 'number' && Number.isSafeInteger(raw.episode_count) ? raw.episode_count : 0
    // A season announced without episodes yet has nothing to open.
    if (season === null || season < 0 || episodeCount <= 0 || seasons.some((entry) => entry.season === season)) continue
    seasons.push({ season, episodeCount })
  }
  return {
    id: tmdbMetaId(id),
    type: 'series',
    name,
    poster: imageUrl(data.poster_path, 'w500'),
    background: imageUrl(data.backdrop_path, 'w780'),
    year: date?.slice(0, 4) ?? null,
    releaseInfo: date,
    rating: readVote(data),
    description: overviewOf(data),
    genres: namesOf(data.genres, MAX_GENRES),
    cast: castOf(data),
    director: namesOf(data.created_by, MAX_PEOPLE),
    runtime: null,
    videos: [],
    streamId: imdbIdOf(data),
    seasons
  }
}

/**
 * The episodes of one season (`/tv/{id}/season/{n}`) as videos. Their id is
 * what stream add-ons are asked by, `<IMDb id>:<season>:<episode>`; without
 * an IMDb id it is the TMDB one (`tmdb:<id>:<season>:<episode>`), which only
 * names the episode: no stream add-on is asked for it.
 */
export function parseTmdbSeason(data: unknown, meta: Pick<AddonMeta, 'id' | 'streamId'>, season: number): AddonVideo[] | null {
  if (!isRecord(data) || !Array.isArray(data.episodes)) return null
  const base = meta.streamId ?? meta.id
  const videos: AddonVideo[] = []
  const seen = new Set<number>()
  for (const raw of readArray(data.episodes, MAX_EPISODES)) {
    if (!isRecord(raw)) continue
    const episode = typeof raw.episode_number === 'number' && Number.isSafeInteger(raw.episode_number) ? raw.episode_number : null
    if (episode === null || episode < 0 || seen.has(episode)) continue
    seen.add(episode)
    const airDate = readDate(raw.air_date)
    const runtime = typeof raw.runtime === 'number' && raw.runtime > 0 ? Math.round(raw.runtime) : null
    videos.push({
      id: `${base}:${season}:${episode}`,
      title: readText(raw.name, MAX_NAME_LENGTH),
      season,
      episode,
      released: airDate,
      thumbnail: imageUrl(raw.still_path, 'w300'),
      overview: readText(raw.overview, MAX_DESCRIPTION_LENGTH, { multiline: true }),
      runtime: runtime ? strings.catalog.detail.minutes(runtime) : null,
      airDate
    })
  }
  return videos
}

export interface TmdbGenre {
  id: number
  name: string
}

export function parseTmdbGenres(data: unknown): TmdbGenre[] | null {
  if (!isRecord(data) || !Array.isArray(data.genres)) return null
  const genres: TmdbGenre[] = []
  for (const raw of readArray(data.genres, 64)) {
    if (!isRecord(raw)) continue
    const id = readTmdbId(raw.id)
    const name = readText(raw.name, MAX_SHORT_TEXT_LENGTH)
    if (id && name && !genres.some((genre) => genre.id === id)) genres.push({ id, name })
  }
  return genres
}

// ---------------------------------------------------------------------------
// The catalogues

/** Catalogue ids of the built-in catalogue; a genre is `genre-<TMDB genre id>`. */
type FixedCatalog = { id: string; name: string; path: string; region: boolean }

function fixedCatalogs(type: AddonContentType): FixedCatalog[] {
  const names = strings.sources.tmdbCatalog.catalogs
  if (type === 'movie') {
    return [
      { id: 'trending', name: names.trending, path: '/trending/movie/week', region: false },
      { id: 'popular', name: names.popular, path: '/movie/popular', region: true },
      { id: 'now_playing', name: names.nowPlaying, path: '/movie/now_playing', region: true },
      { id: 'upcoming', name: names.upcoming, path: '/movie/upcoming', region: true },
      { id: 'top_rated', name: names.topRated, path: '/movie/top_rated', region: true }
    ]
  }
  return [
    { id: 'trending', name: names.trending, path: '/trending/tv/week', region: false },
    { id: 'popular', name: names.popular, path: '/tv/popular', region: false },
    { id: 'on_the_air', name: names.onTheAir, path: '/tv/on_the_air', region: false },
    { id: 'top_rated', name: names.topRated, path: '/tv/top_rated', region: false }
  ]
}

const GENRE_PREFIX = 'genre-'
const SEARCH_CATALOG_ID = 'search'

function pagedCatalog(type: AddonContentType, id: string, name: string): AddonCatalogSummary {
  return { type, id, name, extra: [{ name: 'skip', isRequired: false }] }
}

/**
 * The built-in catalogue's summary, as an add-on's manifest would give it:
 * the fixed lists, then TMDB's genres, for films and for series; a search
 * catalogue per type (not shown as a category: it needs a query). Only
 * `catalog` and `meta` resources: the catalogue gives no streams.
 */
export function tmdbCatalogSummary(genres: { movie: readonly TmdbGenre[]; series: readonly TmdbGenre[] }): AddonManifestSummary {
  const catalogs: AddonCatalogSummary[] = []
  for (const type of ['movie', 'series'] as const) {
    for (const entry of fixedCatalogs(type)) catalogs.push(pagedCatalog(type, entry.id, entry.name))
    for (const genre of genres[type]) catalogs.push(pagedCatalog(type, `${GENRE_PREFIX}${genre.id}`, genre.name))
    catalogs.push({
      type,
      id: SEARCH_CATALOG_ID,
      name: strings.sources.tmdbCatalog.catalogs.search,
      extra: [
        { name: 'search', isRequired: true },
        { name: 'skip', isRequired: false }
      ]
    })
  }
  const types = ['movie', 'series']
  return {
    id: TMDB_CATALOG_MANIFEST_ID,
    name: strings.sources.tmdbCatalog.name,
    version: '',
    resources: [
      { name: 'catalog', types: [...types], idPrefixes: [TMDB_META_PREFIX] },
      { name: 'meta', types: [...types], idPrefixes: [TMDB_META_PREFIX] }
    ],
    catalogs,
    adult: false
  }
}

/** The summary's genres, to keep them when TMDB cannot be asked for new ones. */
export function genresOfSummary(summary: AddonManifestSummary | undefined): { movie: TmdbGenre[]; series: TmdbGenre[] } {
  const result = { movie: [] as TmdbGenre[], series: [] as TmdbGenre[] }
  for (const catalog of summary?.catalogs ?? []) {
    if (!catalog.id.startsWith(GENRE_PREFIX) || (catalog.type !== 'movie' && catalog.type !== 'series')) continue
    const id = Number(catalog.id.slice(GENRE_PREFIX.length))
    if (Number.isSafeInteger(id) && id > 0) result[catalog.type].push({ id, name: catalog.name })
  }
  return result
}

/** The request behind one page of a catalogue, or null for a catalogue id that is not the built-in one's. */
export function tmdbCatalogRequest(
  catalog: Pick<AddonCatalogSummary, 'type' | 'id'>,
  page: number,
  search?: string
): { path: string; query: Query } | null {
  const type = catalog.type
  if (type !== 'movie' && type !== 'series') return null
  const tmdbType = type === 'movie' ? 'movie' : 'tv'
  const base: Query = { language: LANGUAGE, page }
  if (catalog.id === SEARCH_CATALOG_ID) {
    const query = search?.trim()
    if (!query) return null
    return {
      path: `/search/${tmdbType}`,
      query: { ...base, query, include_adult: 'false', ...(type === 'movie' ? { region: REGION } : {}) }
    }
  }
  if (catalog.id.startsWith(GENRE_PREFIX)) {
    const genre = Number(catalog.id.slice(GENRE_PREFIX.length))
    if (!Number.isSafeInteger(genre) || genre <= 0) return null
    return {
      path: `/discover/${tmdbType}`,
      query: {
        ...base,
        with_genres: genre,
        sort_by: 'popularity.desc',
        include_adult: 'false',
        ...(type === 'movie' ? { region: REGION } : {})
      }
    }
  }
  const fixed = fixedCatalogs(type).find((entry) => entry.id === catalog.id)
  if (!fixed) return null
  return { path: fixed.path, query: { ...base, ...(fixed.region ? { region: REGION } : {}) } }
}

// ---------------------------------------------------------------------------
// What the provider asks

export type TmdbDeps = Pick<TmdbRequestOptions, 'fetchImpl' | 'wait'>

function bad(): TmdbRequestError {
  return new TmdbRequestError('bad-response', errors.tmdb.badResponse)
}

/** One page of a catalogue (or of a search, with `search`); `skip` entries were received before. */
export async function fetchTmdbCatalogPage(
  apiKey: string,
  catalog: Pick<AddonCatalogSummary, 'type' | 'id'>,
  skip: number,
  options: { signal?: AbortSignal; search?: string } & TmdbDeps = {}
): Promise<AddonCatalogPage> {
  const page = Math.floor(Math.max(0, skip) / TMDB_PAGE_SIZE) + 1
  const request = tmdbCatalogRequest(catalog, page, options.search)
  if (!request || page > TMDB_MAX_PAGE) return { metas: [], received: 0, ended: true }
  const data = await tmdbRequest(request.path, request.query, { ...options, apiKey })
  const parsed = parseTmdbListPage(data, catalog.type === 'movie' ? 'movie' : 'series', page)
  if (!parsed) throw bad()
  return parsed
}

const DETAIL_APPEND = 'credits,external_ids,translations'

/** A film's or series' meta, in Turkish; null for an id that is not the built-in catalogue's. */
export async function fetchTmdbMeta(
  apiKey: string,
  type: AddonContentType,
  metaId: string,
  options: { signal?: AbortSignal } & TmdbDeps = {}
): Promise<AddonMeta | null> {
  const id = parseTmdbMetaId(metaId)
  if (id === null) return null
  const path = type === 'movie' ? `/movie/${id}` : `/tv/${id}`
  const data = await tmdbRequest(path, { language: LANGUAGE, append_to_response: DETAIL_APPEND }, { ...options, apiKey, cache: true })
  const meta = type === 'movie' ? parseTmdbMovie(data) : parseTmdbSeries(data)
  if (!meta) throw bad()
  return meta
}

/** The episodes of one season of a series meta of the built-in catalogue. */
export async function fetchTmdbSeason(
  apiKey: string,
  meta: Pick<AddonMeta, 'id' | 'streamId'>,
  season: number,
  options: { signal?: AbortSignal } & TmdbDeps = {}
): Promise<AddonVideo[]> {
  const id = parseTmdbMetaId(meta.id)
  if (id === null || !Number.isSafeInteger(season) || season < 0) return []
  const data = await tmdbRequest(`/tv/${id}/season/${season}`, { language: LANGUAGE }, { ...options, apiKey, cache: true })
  const videos = parseTmdbSeason(data, meta, season)
  if (!videos) throw bad()
  return videos
}

/** TMDB's film and series genres, in Turkish. Also how a key is checked before the catalogue is added. */
export async function fetchTmdbGenres(
  apiKey: string,
  options: { signal?: AbortSignal } & TmdbDeps = {}
): Promise<{ movie: TmdbGenre[]; series: TmdbGenre[] }> {
  const request = (path: string) => tmdbRequest(path, { language: LANGUAGE }, { ...options, apiKey, cache: true })
  const [movieData, seriesData] = await Promise.all([request('/genre/movie/list'), request('/genre/tv/list')])
  const movie = parseTmdbGenres(movieData)
  const series = parseTmdbGenres(seriesData)
  if (!movie || !series) throw bad()
  return { movie, series }
}
