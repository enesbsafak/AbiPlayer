import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatalogStore } from '@/catalog/catalog-store'
import { toCatalogSyncError } from '@/catalog/sync-error'
import { errors } from '@/strings/errors'
import { strings } from '@/strings'
import type { PlaylistSource } from '@/types/playlist'
import { mediaKey, targetFromCatalogItem } from '../../../shared/playback'
import { tmdbCatalogSourceFor, catalogSourceReady, TMDB_CATALOG_SOURCE_ID } from './builtin'
import { addonCategoryId, commitAddonCategories, createAddonCatalogPager } from './catalog'
import { refreshAddonSource } from './connect'
import { addonEpisodeTarget, addonMetaToSeriesDetail, loadAddonMeta, loadAddonSeasonEpisodes } from './detail'
import { browsableCatalogs, canBeActiveSource, searchCatalogFor } from './manifest'
import { addonErrorMessage } from './messages'
import { catalogProviderFor, tmdbCatalogProvider } from './provider'
import {
  fetchTmdbCatalogPage,
  forgetTmdbAnswers,
  retryAfterMs,
  tmdbCatalogSummary,
  TmdbRequestError,
  TMDB_API_BASE
} from './tmdb'

/*
 * The built-in TMDB catalogue against a fake TMDB: no request leaves the
 * test. The v3 key is long and recognisable, so the tests can check it never
 * reaches a message.
 */

const V3_KEY = '0123456789abcdef0123456789abcdef'
const V4_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxMjMifQ.c2lnbmF0dXJl'

interface Asked {
  path: string
  query: Record<string, string>
  authorization: string | null
}

type Answer = Response | ((asked: Asked) => Response)

function json(data: unknown, init: ResponseInit = {}): Response {
  return answer(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/**
 * A new response like `answer` (a route may be asked more than once). Not
 * `clone()`: a cloned body's cancel waits for the original to be cancelled too.
 */
function copy(answer: Response): Response {
  const body = answerBodies.get(answer) ?? ''
  return new Response(body, { status: answer.status, headers: answer.headers })
}

const answerBodies = new WeakMap<Response, string>()

/** A response whose body the fake can give again. */
function answer(body: string, init: ResponseInit = {}): Response {
  const response = new Response(body, init)
  answerBodies.set(response, body)
  return response
}

/** A fake TMDB answering by path (without `/3`); unknown paths answer 404. */
function fakeTmdb(routes: Record<string, Answer | Answer[]>) {
  const asked: Asked[] = []
  const counters = new Map<string, number>()
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(url.origin + url.pathname.slice(0, 2)).toBe(`${new URL(TMDB_API_BASE).origin}/3`)
    const path = url.pathname.replace(/^\/3/, '')
    const headers = new Headers(init?.headers)
    const entry: Asked = { path, query: Object.fromEntries(url.searchParams), authorization: headers.get('authorization') }
    asked.push(entry)
    const route = routes[path]
    if (!route) return new Response('{}', { status: 404 })
    const list = Array.isArray(route) ? route : [route]
    const index = counters.get(path) ?? 0
    counters.set(path, index + 1)
    const answer = list[Math.min(index, list.length - 1)]!
    return typeof answer === 'function' ? answer(entry) : copy(answer)
  })
  return { fetchImpl: impl as unknown as typeof fetch, asked }
}

function listPage(page: number, totalPages: number, ids: number[], type: 'movie' | 'tv' = 'movie') {
  return {
    page,
    total_pages: totalPages,
    total_results: totalPages * 20,
    results: ids.map((id) =>
      type === 'movie'
        ? { id, title: `Film ${id}`, release_date: '2021-05-04', poster_path: `/p${id}.jpg`, vote_average: 7.25, vote_count: 10 }
        : { id, name: `Dizi ${id}`, first_air_date: '2019-01-02', poster_path: `/p${id}.jpg`, vote_average: 8, vote_count: 3 }
    )
  }
}

function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => from + index)
}

const GENRES = {
  movie: [
    { id: 28, name: 'Aksiyon' },
    { id: 18, name: 'Dram' }
  ],
  series: [{ id: 10759, name: 'Aksiyon & Macera' }]
}

function tmdbSource(): PlaylistSource {
  return tmdbCatalogSourceFor(tmdbCatalogSummary(GENRES), 1)
}

const MOVIE_DETAIL = {
  id: 603,
  title: 'Matris',
  original_title: 'The Matrix',
  original_language: 'en',
  overview: 'Bir bilgisayar korsanı gerçekliğin ne olduğunu öğrenir.',
  release_date: '1999-03-30',
  runtime: 136,
  vote_average: 8.2,
  vote_count: 25000,
  genres: [{ id: 28, name: 'Aksiyon' }, { id: 878, name: 'Bilim-Kurgu' }],
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  credits: {
    cast: [
      { name: 'Carrie-Anne Moss', order: 2 },
      { name: 'Keanu Reeves', order: 0 },
      { name: 'Laurence Fishburne', order: 1 }
    ],
    crew: [
      { name: 'Lana Wachowski', job: 'Director' },
      { name: 'Bill Pope', job: 'Director of Photography' }
    ]
  },
  external_ids: { imdb_id: 'tt0133093' },
  translations: { translations: [] }
}

const SERIES_DETAIL = {
  id: 1399,
  name: 'Taht Oyunları',
  original_language: 'en',
  overview: '',
  first_air_date: '2011-04-17',
  vote_average: 8.4,
  vote_count: 20000,
  genres: [{ id: 10759, name: 'Aksiyon & Macera' }],
  created_by: [{ name: 'David Benioff' }],
  credits: { cast: [{ name: 'Emilia Clarke', order: 0 }] },
  external_ids: { imdb_id: 'tt0944947' },
  translations: {
    translations: [
      { iso_639_1: 'de', data: { overview: 'Deutsch' } },
      { iso_639_1: 'en', data: { overview: 'Seven noble families fight for control.' } }
    ]
  },
  seasons: [
    { season_number: 0, episode_count: 2 },
    { season_number: 1, episode_count: 3 },
    { season_number: 2, episode_count: 2 },
    // Announced, no episodes yet: nothing to open.
    { season_number: 3, episode_count: 0 }
  ]
}

const SEASON_ONE = {
  episodes: [
    { episode_number: 2, name: 'Kral Yolu', air_date: '2011-04-24', still_path: '/s2.jpg', runtime: 56, overview: 'İkinci' },
    { episode_number: 1, name: 'Kış Geliyor', air_date: '2011-04-17', still_path: '/s1.jpg', runtime: 62, overview: 'Birinci' },
    { episode_number: 3, name: '', air_date: null, still_path: null }
  ]
}

afterEach(() => {
  forgetTmdbAnswers()
  vi.restoreAllMocks()
})

describe('the built-in TMDB catalogue as a source', () => {
  it('lists the fixed catalogues, then the genres, for films and series; search is no category', () => {
    const source = tmdbSource()
    expect(source).toMatchObject({ id: TMDB_CATALOG_SOURCE_ID, type: 'addon', builtin: 'tmdb', name: 'TMDB Kataloğu' })
    expect(source.url).toBeUndefined()
    const names = (type: 'vod' | 'series') => browsableCatalogs(source.addon!, type).map((entry) => entry.name)
    const catalogs = strings.sources.tmdbCatalog.catalogs
    expect(names('vod')).toEqual([
      catalogs.trending,
      catalogs.popular,
      catalogs.nowPlaying,
      catalogs.upcoming,
      catalogs.topRated,
      'Aksiyon',
      'Dram'
    ])
    expect(names('series')).toEqual([catalogs.trending, catalogs.popular, catalogs.onTheAir, catalogs.topRated, 'Aksiyon & Macera'])
    expect(searchCatalogFor(source.addon!, 'vod')?.id).toBe('search')
    expect(searchCatalogFor(source.addon!, 'series')?.id).toBe('search')
    expect(canBeActiveSource(source)).toBe(true)
  })

  it('can ask while a key is saved, and has no provider without one', () => {
    const source = tmdbSource()
    expect(catalogSourceReady(source, null)).toBe(false)
    expect(catalogSourceReady(source, V3_KEY)).toBe(true)
    expect(catalogProviderFor(source, { tmdbApiKey: null })).toBeNull()
    expect(catalogProviderFor(source, { tmdbApiKey: V3_KEY })).not.toBeNull()
  })
})

describe('TMDB catalogue pages', () => {
  it('asks the list in Turkish, for Turkey, and turns skip into TMDB page numbers', async () => {
    const tmdb = fakeTmdb({
      '/movie/popular': (asked) => json(listPage(Number(asked.query.page), 3, range(Number(asked.query.page) * 100, 20)))
    })
    const catalog = { type: 'movie', id: 'popular' }
    const first = await fetchTmdbCatalogPage(V3_KEY, catalog, 0, { fetchImpl: tmdb.fetchImpl })
    const second = await fetchTmdbCatalogPage(V3_KEY, catalog, 20, { fetchImpl: tmdb.fetchImpl })
    const last = await fetchTmdbCatalogPage(V3_KEY, catalog, 40, { fetchImpl: tmdb.fetchImpl })

    expect(tmdb.asked.map((asked) => asked.query.page)).toEqual(['1', '2', '3'])
    expect(tmdb.asked[0]!.query).toMatchObject({ language: 'tr-TR', region: 'TR', api_key: V3_KEY })
    expect(first).toMatchObject({ received: 20, ended: false, total: 60 })
    expect(second.ended).toBe(false)
    expect(last.ended).toBe(true)
    expect(first.metas[0]).toEqual({
      id: 'tmdb:100',
      type: 'movie',
      name: 'Film 100',
      poster: 'https://image.tmdb.org/t/p/w342/p100.jpg',
      background: null,
      year: '2021',
      releaseInfo: '2021',
      rating: '7.3',
      description: null,
      genres: []
    })
  })

  it('never asks for adult titles and drops one that comes anyway', async () => {
    const tmdb = fakeTmdb({
      '/discover/movie': json({
        page: 1,
        total_pages: 1,
        results: [
          { id: 1, title: 'Temiz', release_date: '2020-01-01' },
          { id: 2, title: 'Yetişkin', adult: true }
        ]
      })
    })
    const page = await fetchTmdbCatalogPage(V3_KEY, { type: 'movie', id: 'genre-18' }, 0, { fetchImpl: tmdb.fetchImpl })
    expect(tmdb.asked[0]!.query).toMatchObject({ with_genres: '18', include_adult: 'false', sort_by: 'popularity.desc' })
    expect(page.metas.map((meta) => meta.name)).toEqual(['Temiz'])
  })

  it('stops at TMDB’s last page (500) whatever total it claims', async () => {
    const tmdb = fakeTmdb({ '/trending/tv/week': json(listPage(500, 900, range(1, 20), 'tv')) })
    const page = await fetchTmdbCatalogPage(V3_KEY, { type: 'series', id: 'trending' }, 499 * 20, { fetchImpl: tmdb.fetchImpl })
    expect(tmdb.asked[0]!.query.page).toBe('500')
    expect(tmdb.asked[0]!.query.region).toBeUndefined()
    expect(page.ended).toBe(true)
    expect(page.metas[0]).toMatchObject({ id: 'tmdb:1', type: 'series', name: 'Dizi 1', year: '2019', rating: '8.0' })
    const beyond = await fetchTmdbCatalogPage(V3_KEY, { type: 'series', id: 'trending' }, 500 * 20, { fetchImpl: tmdb.fetchImpl })
    expect(beyond).toEqual({ metas: [], received: 0, ended: true })
    expect(tmdb.asked).toHaveLength(1)
  })

  it('sends a v4 token in the Authorization header, never in the address', async () => {
    const tmdb = fakeTmdb({ '/tv/top_rated': json(listPage(1, 1, [7], 'tv')) })
    await fetchTmdbCatalogPage(V4_TOKEN, { type: 'series', id: 'top_rated' }, 0, { fetchImpl: tmdb.fetchImpl })
    expect(tmdb.asked[0]!.authorization).toBe(`Bearer ${V4_TOKEN}`)
    expect(tmdb.asked[0]!.query.api_key).toBeUndefined()
  })

  it('pages a category through the app’s pager until TMDB’s last page', async () => {
    const tmdb = fakeTmdb({
      '/movie/top_rated': (asked) => json(listPage(Number(asked.query.page), 2, range(Number(asked.query.page) * 100, 20)))
    })
    const store = createCatalogStore()
    const source = tmdbSource()
    commitAddonCategories(source, store)
    const pager = createAddonCatalogPager({
      store,
      getSource: () => source,
      getProvider: () => tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    })
    const categoryId = addonCategoryId(source.id, 'vod', 'top_rated')
    await pager.loadFirstPage(source.id, 'vod', categoryId)
    expect(pager.getPaging(source.id, 'vod', categoryId)).toMatchObject({ pages: 1, nextSkip: 20, ended: false })
    await pager.loadNextPage(source.id, 'vod', categoryId)
    expect(pager.getPaging(source.id, 'vod', categoryId)).toMatchObject({ pages: 2, ended: true })
    expect(store.getCategoryItems(source.id, 'vod', categoryId)).toHaveLength(40)
    expect(store.isCategoryLoaded(source.id, 'vod', categoryId)).toBe(true)
    // The card plays like any add-on film card: an `addon` target, no URL.
    const item = store.getCategoryItems(source.id, 'vod', categoryId)[0]!
    expect(item).toMatchObject({ addonMetaId: 'tmdb:100', streamUrl: '', rating: '7.3', year: '2021' })
  })

  it('asks nothing without a key', async () => {
    const tmdb = fakeTmdb({})
    const store = createCatalogStore()
    const source = tmdbSource()
    commitAddonCategories(source, store)
    const pager = createAddonCatalogPager({
      store,
      getSource: () => source,
      getProvider: (current) => catalogProviderFor(current, { tmdbApiKey: null })
    })
    await pager.loadFirstPage(source.id, 'vod', addonCategoryId(source.id, 'vod', 'popular'))
    expect(tmdb.asked).toHaveLength(0)
    expect(pager.getPaging(source.id, 'vod', addonCategoryId(source.id, 'vod', 'popular'))).toBeNull()
  })
})

describe('TMDB search', () => {
  it('searches films for Turkey and series without a region, page by page', async () => {
    const tmdb = fakeTmdb({
      '/search/movie': (asked) => json(listPage(Number(asked.query.page), 2, range(Number(asked.query.page) * 10, 20))),
      '/search/tv': json(listPage(1, 1, [5], 'tv'))
    })
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    const summary = tmdbSource().addon!
    const movies = searchCatalogFor(summary, 'vod')!
    const first = await provider.catalogPage(movies, { skip: 0, search: ' matris ' }, {})
    const second = await provider.catalogPage(movies, { skip: first.received, search: 'matris' }, {})
    expect(tmdb.asked.map((asked) => asked.query)).toEqual([
      expect.objectContaining({ query: 'matris', page: '1', include_adult: 'false', region: 'TR', language: 'tr-TR' }),
      expect.objectContaining({ query: 'matris', page: '2' })
    ])
    expect(first.ended).toBe(false)
    expect(second.ended).toBe(true)
    const series = await provider.catalogPage(searchCatalogFor(summary, 'series')!, { skip: 0, search: 'taht' }, {})
    expect(tmdb.asked[2]!.query.region).toBeUndefined()
    expect(series.metas[0]?.type).toBe('series')
  })

  it('asks nothing for an empty query', async () => {
    const tmdb = fakeTmdb({})
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    const page = await provider.catalogPage(searchCatalogFor(tmdbSource().addon!, 'vod')!, { skip: 0, search: '  ' }, {})
    expect(page).toEqual({ metas: [], received: 0, ended: true })
    expect(tmdb.asked).toHaveLength(0)
  })
})

describe('TMDB details', () => {
  it('maps a film in Turkish onto the add-on detail, with its IMDb id as the stream id', async () => {
    const tmdb = fakeTmdb({ '/movie/603': json(MOVIE_DETAIL) })
    const source = tmdbSource()
    const meta = await loadAddonMeta(source, 'movie', 'tmdb:603', {}, tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl }))
    expect(tmdb.asked[0]!.query).toMatchObject({ language: 'tr-TR', append_to_response: 'credits,external_ids,translations' })
    expect(meta).toMatchObject({
      id: 'tmdb:603',
      name: 'Matris',
      description: MOVIE_DETAIL.overview,
      year: '1999',
      releaseInfo: '1999-03-30',
      runtime: '136 dk',
      rating: '8.2',
      genres: ['Aksiyon', 'Bilim-Kurgu'],
      cast: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss'],
      director: ['Lana Wachowski'],
      poster: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      streamId: 'tt0133093'
    })
    // The card with that stream id plays (and keeps its history) under the IMDb id.
    const target = targetFromCatalogItem({ sourceId: source.id, type: 'vod', addonMetaId: 'tmdb:603', addonVideoId: meta!.streamId! })
    expect(target).toEqual({ kind: 'addon', sourceId: source.id, contentType: 'movie', metaId: 'tmdb:603', videoId: 'tt0133093' })
    expect(mediaKey(target!)).toBe(`addon:${source.id}:tt0133093`)
  })

  it('says when TMDB has no IMDb id for a title: nothing can be asked of stream add-ons', async () => {
    const tmdb = fakeTmdb({ '/movie/9': json({ ...MOVIE_DETAIL, id: 9, external_ids: { imdb_id: null }, imdb_id: '' }) })
    const meta = await tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl }).meta('movie', 'tmdb:9', {})
    expect(meta?.streamId).toBeNull()
    // Its detail still opens with everything else.
    expect(meta?.name).toBe('Matris')
  })

  it('falls back to the overview in the original language, then English, when the Turkish one is empty', async () => {
    const tmdb = fakeTmdb({
      '/tv/1399': json(SERIES_DETAIL),
      '/movie/77': json({
        ...MOVIE_DETAIL,
        id: 77,
        overview: '',
        original_language: 'ko',
        translations: { translations: [{ iso_639_1: 'en', data: { overview: 'English' } }, { iso_639_1: 'ko', data: { overview: '한국어 줄거리' } }] }
      })
    })
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    expect((await provider.meta('movie', 'tmdb:77', {}))?.description).toBe('한국어 줄거리')
    expect((await provider.meta('series', 'tmdb:1399', {}))?.description).toBe('Seven noble families fight for control.')
  })

  it('lists a series’ seasons at once and loads each season’s episodes when it is opened', async () => {
    const tmdb = fakeTmdb({ '/tv/1399': json(SERIES_DETAIL), '/tv/1399/season/1': json(SEASON_ONE) })
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    const meta = (await provider.meta('series', 'tmdb:1399', {}))!
    expect(meta).toMatchObject({ streamId: 'tt0944947', director: ['David Benioff'], cast: ['Emilia Clarke'], videos: [] })

    const detail = addonMetaToSeriesDetail(meta)
    // Specials last, as for an add-on; a season without episodes is left out.
    expect(detail.seasons.map((season) => [season.seasonNumber, season.episodeCount])).toEqual([
      [1, 3],
      [2, 2],
      [0, 2]
    ])
    expect(detail.episodes).toEqual({})
    expect(tmdb.asked.map((asked) => asked.path)).toEqual(['/tv/1399'])

    const episodes = await loadAddonSeasonEpisodes(provider, meta, 1)
    expect(tmdb.asked.map((asked) => asked.path)).toEqual(['/tv/1399', '/tv/1399/season/1'])
    expect(episodes.map((episode) => [episode.id, episode.episodeNum, episode.title])).toEqual([
      ['tt0944947:1:1', 1, 'Kış Geliyor'],
      ['tt0944947:1:2', 2, 'Kral Yolu'],
      ['tt0944947:1:3', 3, '']
    ])
    expect(episodes[0]).toMatchObject({
      airDate: '2011-04-17',
      duration: '62 dk',
      coverUrl: 'https://image.tmdb.org/t/p/w300/s1.jpg',
      plot: 'Birinci',
      season: 1,
      streamUrl: ''
    })
    expect(episodes[2]!.airDate).toBeUndefined()
    // What stream add-ons are asked by, and what the history keys it by.
    expect(addonEpisodeTarget('builtin_tmdb', meta.id, episodes[1]!)).toMatchObject({ videoId: 'tt0944947:1:2', metaId: 'tmdb:1399' })
  })

  it('names episodes of a series without an IMDb id by TMDB id', async () => {
    const tmdb = fakeTmdb({
      '/tv/5': json({ ...SERIES_DETAIL, id: 5, external_ids: {} }),
      '/tv/5/season/1': json(SEASON_ONE)
    })
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    const meta = (await provider.meta('series', 'tmdb:5', {}))!
    expect(meta.streamId).toBeNull()
    const episodes = await loadAddonSeasonEpisodes(provider, meta, 1)
    expect(episodes[0]!.id).toBe('tmdb:5:1:1')
  })

  it('keeps a detail it fetched for a while instead of asking again', async () => {
    const tmdb = fakeTmdb({ '/movie/603': json(MOVIE_DETAIL) })
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    await provider.meta('movie', 'tmdb:603', {})
    await provider.meta('movie', 'tmdb:603', {})
    expect(tmdb.asked).toHaveLength(1)
    // Another key is another answer.
    await tmdbCatalogProvider(V4_TOKEN, { fetchImpl: tmdb.fetchImpl }).meta('movie', 'tmdb:603', {})
    expect(tmdb.asked).toHaveLength(2)
  })

  it('has no meta for an id that is not its own', async () => {
    const tmdb = fakeTmdb({})
    expect(await tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl }).meta('movie', 'tt0133093', {})).toBeNull()
    expect(tmdb.asked).toHaveLength(0)
  })
})

describe('TMDB failures', () => {
  const page = (fetchImpl: typeof fetch, wait?: (ms: number) => Promise<void>) =>
    fetchTmdbCatalogPage(V3_KEY, { type: 'movie', id: 'popular' }, 0, { fetchImpl, wait })

  async function failure(promise: Promise<unknown>): Promise<TmdbRequestError> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(TmdbRequestError)
    const failed = error as TmdbRequestError
    expect(failed.message).not.toContain(V3_KEY)
    expect(JSON.stringify(failed)).not.toContain(V3_KEY)
    return failed
  }

  it('words a refused key (401) as TMDB’s, not as an add-on’s address, all the way to the screen', async () => {
    const tmdb = fakeTmdb({ '/movie/popular': answer('{"status_code":7}', { status: 401 }) })
    const error = await failure(page(tmdb.fetchImpl))
    expect(error).toMatchObject({ kind: 'auth', status: 401, message: errors.tmdb.keyRefused })
    expect(error.retryable).toBe(false)
    expect(addonErrorMessage(error)).toBe(errors.tmdb.keyRefused)
    // Through the pager's error state too.
    const synced = toCatalogSyncError(error)
    expect(synced).toMatchObject({ origin: 'tmdb', message: errors.tmdb.keyRefused })
    expect(addonErrorMessage(synced)).toBe(errors.tmdb.keyRefused)
  })

  it('waits as long as Retry-After asks and tries once more on 429', async () => {
    const tmdb = fakeTmdb({
      '/movie/popular': [answer('', { status: 429, headers: { 'Retry-After': '3' } }), json(listPage(1, 1, [1]))]
    })
    const wait = vi.fn(async () => undefined)
    const result = await page(tmdb.fetchImpl, wait)
    expect(wait).toHaveBeenCalledWith(3000, undefined)
    expect(tmdb.asked).toHaveLength(2)
    expect(result.metas).toHaveLength(1)
  })

  it('says TMDB is busy when the retry is refused too, without a third request', async () => {
    const tmdb = fakeTmdb({ '/movie/popular': answer('', { status: 429 }) })
    const wait = vi.fn(async () => undefined)
    const error = await failure(page(tmdb.fetchImpl, wait))
    expect(error).toMatchObject({ status: 429, message: errors.tmdb.rateLimited })
    expect(error.retryable).toBe(true)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(tmdb.asked).toHaveLength(2)
  })

  it('does not wait for a Retry-After longer than it would, nor ask again', async () => {
    const tmdb = fakeTmdb({ '/movie/popular': answer('', { status: 429, headers: { 'Retry-After': '120' } }) })
    const wait = vi.fn(async () => undefined)
    const error = await failure(page(tmdb.fetchImpl, wait))
    expect(error.message).toBe(errors.tmdb.rateLimited)
    expect(wait).not.toHaveBeenCalled()
    expect(tmdb.asked).toHaveLength(1)
  })

  it('reads Retry-After as seconds or a date, with a default', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs(null)).toBe(2000)
    expect(retryAfterMs(new Date(10_000).toUTCString(), 5_000)).toBe(5_000)
    expect(retryAfterMs('11')).toBeNull()
  })

  it('says TMDB cannot be reached when offline', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const error = await failure(page(offline))
    expect(error).toMatchObject({ kind: 'network', message: errors.tmdb.offline })
    expect(error.retryable).toBe(true)
  })

  it('names a missing title and an answer it cannot read', async () => {
    const tmdb = fakeTmdb({ '/movie/1': answer('', { status: 404 }), '/movie/2': answer('<html>', { status: 200 }) })
    const provider = tmdbCatalogProvider(V3_KEY, { fetchImpl: tmdb.fetchImpl })
    expect((await failure(provider.meta('movie', 'tmdb:1', {}))).message).toBe(errors.tmdb.notFound)
    expect((await failure(provider.meta('movie', 'tmdb:2', {}))).message).toBe(errors.tmdb.badResponse)
  })

  it('cancels without an error message of its own', async () => {
    const controller = new AbortController()
    const never = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))))
    ) as unknown as typeof fetch
    const pending = fetchTmdbCatalogPage(V3_KEY, { type: 'movie', id: 'popular' }, 0, { fetchImpl: never, signal: controller.signal })
    controller.abort()
    const error = await pending.catch((caught: unknown) => caught)
    expect(error).toMatchObject({ kind: 'aborted' })
    expect(toCatalogSyncError(error)).toBeNull()
  })
})

describe('connecting the TMDB catalogue', () => {
  it('builds its catalogues with TMDB’s genres and puts them in the store as categories', async () => {
    const tmdb = fakeTmdb({ '/genre/movie/list': json({ genres: GENRES.movie }), '/genre/tv/list': json({ genres: GENRES.series }) })
    const store = createCatalogStore()
    const source = tmdbCatalogSourceFor(tmdbCatalogSummary({ movie: [], series: [] }), 1)
    const updateSummary = vi.fn()
    const outcome = await refreshAddonSource(source, { tmdbApiKey: V3_KEY, tmdb: { fetchImpl: tmdb.fetchImpl }, updateSummary, store })
    expect(outcome.session.manifestFresh).toBe(true)
    expect(updateSummary).toHaveBeenCalledTimes(1)
    expect(store.getCategories(source.id, 'vod').map((category) => category.name)).toContain('Dram')
    expect(store.getCategories(source.id, 'series').map((category) => category.name)).toContain('Aksiyon & Macera')
  })

  it('keeps its stored catalogues without a key or with TMDB away', async () => {
    const store = createCatalogStore()
    const source = tmdbSource()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const outcome = await refreshAddonSource(source, { tmdbApiKey: null, updateSummary: vi.fn(), store })
    expect(outcome.session.manifestFresh).toBe(false)
    expect(store.getCategories(source.id, 'vod').map((category) => category.name)).toContain('Aksiyon')
    await expect(refreshAddonSource(source, { tmdbApiKey: null, updateSummary: vi.fn(), store }, { strict: true })).rejects.toMatchObject({
      message: errors.tmdb.noKey
    })
  })
})
