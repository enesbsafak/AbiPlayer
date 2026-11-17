// A fake TMDB for the built-in TMDB catalogue (src/renderer/src/addons/tmdb.ts):
// lists, genres, search, film and series details and seasons, and the poster
// images, answered from memory. It is no server: the scenarios hand the
// renderer's requests to `answerTmdb` with Playwright's request routing
// (support/tmdb.ts), so the real TMDB is never contacted and the app needs
// no switch to point elsewhere. Titles are invented; the IMDb ids are the
// ones the fake stream add-on (addons.ts) has streams for.

import { ADDON_KNOWN } from './addons.ts'
import { artworkPng } from './png.ts'

/** A v3 key of the right shape; the fake accepts it and refuses any other with 401. */
export const MOCK_TMDB_KEY = '0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e'

const PAGE_SIZE = 20

/** Names and counts the scenario refers to. */
export const TMDB_KNOWN = {
  movieGenres: ['Aksiyon', 'Dram'],
  seriesGenres: ['Bilim Kurgu & Fantazi', 'Dram'],
  /** Film catalogues on Filmler: the five fixed ones, then the genres. */
  filmCatalogCount: 7,
  seriesCatalogCount: 6,
  /** "Popüler" has this many films over three pages (20, 20, 5). */
  popularCount: 45,
  popularFilm(index: number): string {
    return `Popüler Yapım ${String(index).padStart(2, '0')}`
  },
  /** Its IMDb id is the fake stream add-on's film: two candidates. */
  film: ADDON_KNOWN.film,
  filmId: 9001,
  filmPlot: 'Bir deniz feneri bekçisi, sisli bir gecede kıyıya vuran bir sandığın peşine düşer.',
  filmRuntime: '104 dk',
  filmDirector: 'Zeynep Uydurma',
  filmCast: 'Ayşe Örnek, Mehmet Deneme',
  /** TMDB has no IMDb id for it: no stream add-on can be asked. */
  filmWithoutImdb: 'Kayıtsız Sahne',
  filmWithoutImdbId: 9002,
  /** Its IMDb id is the fake stream add-on's series. */
  series: ADDON_KNOWN.series,
  seriesId: 7001,
  seasonOne: ADDON_KNOWN.seasonOne,
  seasonTwo: ADDON_KNOWN.seasonTwo,
  special: ADDON_KNOWN.special,
  /** The search box's query that finds the film. */
  filmQuery: 'deniz'
} as const

export interface TmdbAnswer {
  status: number
  contentType: string
  body: string | Buffer
}

interface ListEntry {
  id: number
  title: string
  date: string
}

const FILM: ListEntry = { id: TMDB_KNOWN.filmId, title: TMDB_KNOWN.film, date: '2023-04-12' }
const FILM_WITHOUT_IMDB: ListEntry = { id: TMDB_KNOWN.filmWithoutImdbId, title: TMDB_KNOWN.filmWithoutImdb, date: '2022-11-02' }
const SERIES: ListEntry = { id: TMDB_KNOWN.seriesId, title: TMDB_KNOWN.series, date: '2021-09-01' }

const POPULAR: ListEntry[] = [
  FILM,
  FILM_WITHOUT_IMDB,
  ...Array.from({ length: TMDB_KNOWN.popularCount - 2 }, (_, index) => ({
    id: 9100 + index,
    title: TMDB_KNOWN.popularFilm(index + 3),
    date: `20${String(10 + (index % 14)).padStart(2, '0')}-06-01`
  }))
]

const OTHER_FILMS: ListEntry[] = [FILM, FILM_WITHOUT_IMDB, ...POPULAR.slice(2, 8)]
const SERIES_LIST: ListEntry[] = [
  SERIES,
  ...Array.from({ length: 5 }, (_, index) => ({ id: 7100 + index, title: `Uydurma Dizi ${index + 1}`, date: '2020-02-02' }))
]

function json(data: unknown, status = 200): TmdbAnswer {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) }
}

function listEntry(entry: ListEntry, kind: 'movie' | 'tv') {
  const common = {
    id: entry.id,
    overview: '',
    poster_path: `/poster-${entry.id}.png`,
    backdrop_path: `/backdrop-${entry.id}.png`,
    vote_average: 6 + (entry.id % 30) / 10,
    vote_count: 100,
    adult: false
  }
  return kind === 'movie'
    ? { ...common, title: entry.title, original_title: entry.title, release_date: entry.date }
    : { ...common, name: entry.title, original_name: entry.title, first_air_date: entry.date }
}

function listPage(entries: readonly ListEntry[], kind: 'movie' | 'tv', page: number): TmdbAnswer {
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const results = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => listEntry(entry, kind))
  return json({ page, results, total_pages: totalPages, total_results: entries.length })
}

function movieDetail(entry: ListEntry, imdbId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: entry.id,
    title: entry.title,
    original_title: entry.title,
    original_language: 'tr',
    overview: '',
    release_date: entry.date,
    runtime: 98,
    vote_average: 7.1,
    vote_count: 320,
    genres: [{ id: 18, name: 'Dram' }],
    poster_path: `/poster-${entry.id}.png`,
    backdrop_path: `/backdrop-${entry.id}.png`,
    credits: { cast: [], crew: [] },
    external_ids: { imdb_id: imdbId },
    translations: { translations: [] },
    ...extra
  }
}

const EPISODES: Record<number, readonly string[]> = {
  0: [TMDB_KNOWN.special],
  1: TMDB_KNOWN.seasonOne,
  2: TMDB_KNOWN.seasonTwo
}

function seriesDetail() {
  return {
    id: SERIES.id,
    name: SERIES.title,
    original_name: SERIES.title,
    original_language: 'tr',
    // Empty in Turkish: the page falls back to the original language's text.
    overview: '',
    first_air_date: SERIES.date,
    vote_average: 8.3,
    vote_count: 900,
    genres: [{ id: 18, name: 'Dram' }],
    created_by: [{ name: 'Selin Kurgu' }],
    poster_path: `/poster-${SERIES.id}.png`,
    backdrop_path: `/backdrop-${SERIES.id}.png`,
    credits: { cast: [{ name: 'Deniz Oyuncu', order: 0 }, { name: 'Ece Rol', order: 1 }] },
    external_ids: { imdb_id: 'tt9300001' },
    translations: {
      translations: [{ iso_639_1: 'tr', data: { overview: 'Sisli bir vadide kaybolan bir köyün izini süren iki kardeş.' } }]
    },
    seasons: [0, 1, 2].map((season) => ({ season_number: season, episode_count: EPISODES[season]!.length, name: `Sezon ${season}` }))
  }
}

function season(number: number): TmdbAnswer {
  const names = EPISODES[number]
  if (!names) return json({ status_code: 34 }, 404)
  return json({
    season_number: number,
    episodes: names.map((name, index) => ({
      episode_number: index + 1,
      name,
      overview: `${name} bölümünün özeti.`,
      air_date: `202${number}-0${index + 1}-1${index}`,
      runtime: 42 + index,
      still_path: `/still-${number}-${index + 1}.png`
    }))
  })
}

/**
 * The answer to one TMDB API request (`https://api.themoviedb.org/3/...`).
 * A key other than `MOCK_TMDB_KEY` is refused with 401, as TMDB does.
 */
export function answerTmdb(url: URL, authorization: string | null = null): TmdbAnswer {
  const key = url.searchParams.get('api_key') ?? authorization?.replace(/^Bearer /, '') ?? null
  if (key !== MOCK_TMDB_KEY) return json({ status_code: 7, status_message: 'Invalid API key' }, 401)
  const path = url.pathname.replace(/^\/3/, '')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)

  if (path === '/genre/movie/list') {
    return json({ genres: [{ id: 28, name: TMDB_KNOWN.movieGenres[0] }, { id: 18, name: TMDB_KNOWN.movieGenres[1] }] })
  }
  if (path === '/genre/tv/list') {
    return json({ genres: [{ id: 10765, name: TMDB_KNOWN.seriesGenres[0] }, { id: 18, name: TMDB_KNOWN.seriesGenres[1] }] })
  }
  if (path === '/movie/popular') return listPage(POPULAR, 'movie', page)
  if (/^\/(trending\/movie\/week|movie\/(now_playing|upcoming|top_rated)|discover\/movie)$/.test(path)) {
    return listPage(OTHER_FILMS, 'movie', page)
  }
  if (/^\/(trending\/tv\/week|tv\/(popular|on_the_air|top_rated)|discover\/tv)$/.test(path)) return listPage(SERIES_LIST, 'tv', page)
  if (path === '/search/movie' || path === '/search/tv') {
    const query = (url.searchParams.get('query') ?? '').toLocaleLowerCase('tr')
    const pool = path === '/search/movie' ? POPULAR : SERIES_LIST
    const found = pool.filter((entry) => entry.title.toLocaleLowerCase('tr').includes(query))
    return listPage(found, path === '/search/movie' ? 'movie' : 'tv', page)
  }

  const movie = /^\/movie\/(\d+)$/.exec(path)
  if (movie) {
    const id = Number(movie[1])
    if (id === FILM.id) {
      return json(
        movieDetail(FILM, ADDON_KNOWN.filmId, {
          overview: TMDB_KNOWN.filmPlot,
          runtime: 104,
          credits: {
            cast: [
              { name: 'Ayşe Örnek', order: 0 },
              { name: 'Mehmet Deneme', order: 1 }
            ],
            crew: [{ name: TMDB_KNOWN.filmDirector, job: 'Director' }]
          }
        })
      )
    }
    if (id === FILM_WITHOUT_IMDB.id) return json(movieDetail(FILM_WITHOUT_IMDB, null, { overview: 'IMDb kimliği olmayan bir film.' }))
    const entry = POPULAR.find((candidate) => candidate.id === id)
    return entry ? json(movieDetail(entry, `tt98${String(id).padStart(5, '0')}`)) : json({ status_code: 34 }, 404)
  }
  if (path === `/tv/${SERIES.id}`) return json(seriesDetail())
  const seasonMatch = new RegExp(`^/tv/${SERIES.id}/season/(\\d+)$`).exec(path)
  if (seasonMatch) return season(Number(seasonMatch[1]))
  const otherSeries = /^\/tv\/(\d+)$/.exec(path)
  if (otherSeries) {
    const entry = SERIES_LIST.find((candidate) => candidate.id === Number(otherSeries[1]))
    if (entry) {
      return json({ ...seriesDetail(), id: entry.id, name: entry.title, external_ids: { imdb_id: null }, seasons: [] })
    }
  }
  return json({ status_code: 34, status_message: 'The resource you requested could not be found.' }, 404)
}

/** A poster, backdrop or still (`https://image.tmdb.org/t/p/<size>/<file>.png`). */
export function answerTmdbImage(url: URL): TmdbAnswer {
  const match = /\/(poster|backdrop|still)-([\d-]+)\.png$/.exec(url.pathname)
  if (!match) return { status: 404, contentType: 'text/plain', body: 'yok' }
  const seed = Number(match[2]!.replace(/-/g, ''))
  const png = match[1] === 'poster' ? artworkPng(seed, 120, 180) : artworkPng(seed, 320, 180)
  return { status: 200, contentType: 'image/png', body: png }
}
