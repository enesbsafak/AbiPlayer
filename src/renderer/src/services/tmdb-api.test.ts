import { afterEach, describe, expect, it, vi } from 'vitest'
import { itemAt } from '../../../shared/checked'
import {
  cleanTitleForTmdbSearch,
  normalizeTitleForMatch,
  pickConfidentTmdbMatch,
  resolveTmdbMovieDetails,
  resolveTmdbSeasonEpisodes,
  resolveTmdbTvDetails
} from './tmdb-api'

describe('cleanTitleForTmdbSearch', () => {
  it('removes provider prefixes, years and quality tags', () => {
    expect(cleanTitleForTmdbSearch('TR: Esaretin Bedeli (1994) 4K')).toEqual({ title: 'Esaretin Bedeli', year: '1994' })
    expect(cleanTitleForTmdbSearch('[EN] Inception [2010] 1080p BluRay')).toEqual({ title: 'Inception', year: '2010' })
    expect(cleanTitleForTmdbSearch('VIP | Yeşil Yol - TR Dublaj')).toEqual({ title: 'Yeşil Yol', year: '' })
    expect(cleanTitleForTmdbSearch('4K-TR: Dune: Çöl Gezegeni (2021) HDR')).toEqual({ title: 'Dune: Çöl Gezegeni', year: '2021' })
    expect(cleanTitleForTmdbSearch('TR - Babam ve Oğlum FHD')).toEqual({ title: 'Babam ve Oğlum', year: '' })
    expect(cleanTitleForTmdbSearch('|TR| Kurtlar Vadisi ALTYAZILI')).toEqual({ title: 'Kurtlar Vadisi', year: '' })
  })

  it('reads dotted scene names', () => {
    expect(cleanTitleForTmdbSearch('The.Matrix.1999.1080p.BluRay.x264')).toEqual({ title: 'The Matrix', year: '1999' })
  })

  it('keeps years and colons that belong to the title', () => {
    expect(cleanTitleForTmdbSearch('Blade Runner 2049 4K')).toEqual({ title: 'Blade Runner 2049', year: '' })
    expect(cleanTitleForTmdbSearch('1917 (2019)')).toEqual({ title: '1917', year: '2019' })
    expect(cleanTitleForTmdbSearch('Star Wars: Yeni Umut')).toEqual({ title: 'Star Wars: Yeni Umut', year: '' })
    expect(cleanTitleForTmdbSearch('X-Men')).toEqual({ title: 'X-Men', year: '' })
  })

  it('handles empty and non-string input', () => {
    expect(cleanTitleForTmdbSearch('')).toEqual({ title: '', year: '' })
    expect(cleanTitleForTmdbSearch(undefined)).toEqual({ title: '', year: '' })
    expect(cleanTitleForTmdbSearch(42 as unknown as string)).toEqual({ title: '', year: '' })
  })
})

describe('normalizeTitleForMatch', () => {
  it('ignores case, Turkish letters, diacritics and punctuation', () => {
    expect(normalizeTitleForMatch('Çağ: Başlangıç')).toBe(normalizeTitleForMatch('cag baslangic'))
    expect(normalizeTitleForMatch('İNCEPTİON')).toBe('inception')
    expect(normalizeTitleForMatch('Amélie')).toBe('amelie')
    expect(normalizeTitleForMatch('Spider-Man')).toBe(normalizeTitleForMatch('Spider Man'))
    expect(normalizeTitleForMatch('Fast & Furious')).toBe('fast and furious')
  })
})

describe('pickConfidentTmdbMatch', () => {
  const candidates = [
    { id: 1, title: 'Başka Bir Film', originalTitle: 'Another Film', date: '2019-05-01' },
    { id: 2, title: 'Yeşil Yol', originalTitle: 'The Green Mile', date: '1999-12-10' },
    { id: 3, title: 'Yeşil Yol', originalTitle: 'Yeşil Yol', date: '2015-01-01' }
  ]

  it('returns no match when no title matches, instead of the first result', () => {
    expect(pickConfidentTmdbMatch(candidates, 'Tamamen Farklı')).toBeNull()
    expect(pickConfidentTmdbMatch([], 'Yeşil Yol')).toBeNull()
    expect(pickConfidentTmdbMatch(candidates, '')).toBeNull()
  })

  it('matches the localized or the original title', () => {
    expect(pickConfidentTmdbMatch(candidates, 'The Green Mile')?.id).toBe(2)
    expect(pickConfidentTmdbMatch(candidates, 'yesil yol')?.id).toBe(2)
  })

  it('uses the year to choose between same-name results and tolerates one year off', () => {
    expect(pickConfidentTmdbMatch(candidates, 'Yeşil Yol', '2015')?.id).toBe(3)
    expect(pickConfidentTmdbMatch(candidates, 'Yeşil Yol', 2000)?.id).toBe(2)
  })

  it('rejects a same-name result from a different year', () => {
    expect(pickConfidentTmdbMatch(candidates, 'Yeşil Yol', '2008')).toBeNull()
    expect(pickConfidentTmdbMatch([{ id: 9, title: 'Film' }], 'Film', '2001')).toBeNull()
  })
})

describe('resolveTmdb* with a mocked API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubTmdb(routes: Record<string, unknown>) {
    const fetchMock = vi.fn((input: string) => {
      const { pathname } = new URL(input)
      const route = Object.keys(routes).find((path) => pathname.endsWith(path))
      if (!route) return Promise.resolve(new Response('not found', { status: 404 }))
      return Promise.resolve(new Response(JSON.stringify(routes[route]), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('does not take the first search hit when nothing matches confidently', async () => {
    const fetchMock = stubTmdb({
      '/search/movie': { results: [{ id: 77, title: 'Alakasız Bir Film', release_date: '2001-01-01' }] }
    })

    const details = await resolveTmdbMovieDetails({ apiKey: 'k-none', name: 'TR: Kayıp Film (2019) 4K' })

    expect(details).toBeNull()
    // Only the search ran; no details were fetched for the unrelated hit.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const searchUrl = new URL(itemAt(fetchMock.mock.calls, 0)[0])
    expect(searchUrl.searchParams.get('query')).toBe('Kayıp Film')
    expect(searchUrl.searchParams.get('year')).toBe('2019')
  })

  it('fetches details for a confident match', async () => {
    stubTmdb({
      '/search/movie': {
        results: [
          { id: 5, title: 'Başka', release_date: '2010-01-01' },
          { id: 6, title: 'Başlangıç', original_title: 'Inception', release_date: '2010-07-16' }
        ]
      },
      '/movie/6': {
        id: 6,
        title: 'Başlangıç',
        overview: 'Rüya içinde rüya.',
        genres: [{ id: 1, name: 'Bilim Kurgu' }, { id: 2 }],
        credits: { cast: [{ name: 'B', order: 2 }, { name: 'A', order: 1 }, 'junk'], crew: [{ name: 'Nolan', job: 'Director' }] },
        poster_path: '/p.jpg'
      }
    })

    const details = await resolveTmdbMovieDetails({ apiKey: 'k-match', name: '[EN] Inception (2010) 1080p' })

    expect(details).toMatchObject({
      id: 6,
      title: 'Başlangıç',
      overview: 'Rüya içinde rüya.',
      genres: ['Bilim Kurgu'],
      cast: ['A', 'B'],
      directors: ['Nolan'],
      posterPath: 'https://image.tmdb.org/t/p/w500/p.jpg'
    })
  })

  it('rejects malformed responses with a Turkish error', async () => {
    stubTmdb({ '/search/tv': { status_message: 'oops' } })
    await expect(resolveTmdbTvDetails({ apiKey: 'k-bad', name: 'Dizi' })).rejects.toThrow('TMDB geçersiz bir yanıt döndürdü')

    stubTmdb({ '/movie/12': { title: 'Kimliksiz' } })
    await expect(resolveTmdbMovieDetails({ apiKey: 'k-bad2', tmdbId: 12 })).rejects.toThrow('TMDB geçersiz bir yanıt döndürdü')
  })

  it('skips malformed season episodes', async () => {
    stubTmdb({
      '/tv/3/season/1': {
        episodes: [
          { id: 1, episode_number: 1, name: 'Pilot', runtime: 42 },
          { id: 'x', episode_number: 2 },
          null
        ]
      }
    })

    const episodes = await resolveTmdbSeasonEpisodes({ apiKey: 'k-season', tmdbTvId: 3, seasonNumber: 1 })
    expect(episodes).toEqual([
      {
        id: 1,
        name: 'Pilot',
        overview: undefined,
        episodeNumber: 1,
        runtime: 42,
        stillPath: undefined,
        voteAverage: undefined,
        airDate: undefined
      }
    ])
  })
})
