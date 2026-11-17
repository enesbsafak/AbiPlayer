import { describe, expect, it, vi } from 'vitest'
import { mediaKey } from '../../../shared/playback'
import { defined } from '../../../shared/checked'
import { parseMeta, type AddonMeta } from './client'
import {
  addonEpisodeChannel,
  addonEpisodeTarget,
  addonMetaToSeriesDetail,
  addonMetaToVodInfo,
  loadAddonMeta
} from './detail'
import { CATALOG_BASE, catalogSource, jsonResponse, routeFetch, streamSource } from './testing/fixtures'

function meta(raw: Record<string, unknown>): AddonMeta {
  return defined(parseMeta({ meta: { id: 'tt0000009', type: 'series', name: 'Örnek Dizi', ...raw } }))
}

describe('film detail', () => {
  it('maps a meta onto the film detail fields', () => {
    expect(
      addonMetaToVodInfo(
        meta({
          type: 'movie',
          description: 'Bir özet.',
          cast: ['Oyuncu A', 'Oyuncu B'],
          director: ['Yönetmen C'],
          genres: ['Dram', 'Gizem'],
          runtime: '112 dk',
          releaseInfo: '2019',
          imdbRating: '7.8',
          poster: 'https://img.addon.example/p.jpg',
          background: 'https://img.addon.example/b.jpg'
        })
      )
    ).toEqual({
      name: 'Örnek Dizi',
      plot: 'Bir özet.',
      cast: 'Oyuncu A, Oyuncu B',
      director: 'Yönetmen C',
      genre: 'Dram, Gizem',
      releaseDate: '2019',
      duration: '112 dk',
      rating: '7.8',
      year: '2019',
      cover: 'https://img.addon.example/p.jpg',
      backdrop: 'https://img.addon.example/b.jpg'
    })
  })

  it('leaves missing fields empty', () => {
    expect(addonMetaToVodInfo(meta({}))).toMatchObject({ plot: '', cast: '', rating: '', cover: '', backdrop: '' })
  })
})

describe('series detail', () => {
  const series = meta({
    videos: [
      { id: 'tt9:0:1', title: 'Özel bölüm', season: 0, episode: 1 },
      { id: 'tt9:2:2', title: 'İkinci sezon 2', season: 2, episode: 2 },
      { id: 'tt9:1:2', title: 'Bir-iki', season: 1, episode: 2, released: '2020-01-08T00:00:00.000Z' },
      { id: 'tt9:2:1', title: 'İkinci sezon 1', season: 2, number: 1, thumbnail: 'https://img.addon.example/21.jpg' },
      { id: 'tt9:1:1', title: 'Bir-bir', season: 1, episode: 1, overview: 'Başlangıç' },
      { id: 'tt9:1:x', title: 'Numarasız', season: 1 }
    ]
  })
  const detail = addonMetaToSeriesDetail(series)

  it('sorts seasons with the specials last', () => {
    expect(detail.seasons.map((season) => season.seasonNumber)).toEqual([1, 2, 0])
    expect(detail.seasons.map((season) => season.episodeCount)).toEqual([3, 2, 1])
    expect(detail.seasons[0]?.name).toBe('Sezon 1')
    expect(detail.seasons[2]?.name).toBe('')
  })

  it('orders episodes by number, a numberless one after them, and keeps the video id', () => {
    expect(detail.episodes[1]?.map((episode) => episode.id)).toEqual(['tt9:1:1', 'tt9:1:2', 'tt9:1:x'])
    expect(detail.episodes[1]?.map((episode) => episode.episodeNum)).toEqual([1, 2, 3])
    expect(detail.episodes[2]?.[0]).toEqual({
      id: 'tt9:2:1',
      episodeNum: 1,
      title: 'İkinci sezon 1',
      containerExtension: '',
      plot: '',
      duration: '',
      durationSecs: 0,
      rating: 0,
      season: 2,
      coverUrl: 'https://img.addon.example/21.jpg',
      streamUrl: ''
    })
    expect(detail.episodes[1]?.[0]?.plot).toBe('Başlangıç')
    expect(detail.seriesId).toBe(0)
  })

  it('falls back to release date, then the add-on’s order', () => {
    const dated = addonMetaToSeriesDetail(
      meta({
        videos: [
          { id: 'c', season: 1, released: '2021-03-01' },
          { id: 'a', season: 1, released: '2021-01-01' },
          { id: 'd', season: 1 },
          { id: 'b', season: 1, released: '2021-02-01' },
          { id: 'e', season: 1 }
        ]
      })
    )
    expect(dated.episodes[1]?.map((episode) => episode.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('puts videos into season 1 when none has a season, and drops seasonless ones otherwise', () => {
    const flat = addonMetaToSeriesDetail(meta({ videos: [{ id: 'a' }, { id: 'b' }] }))
    expect(flat.seasons.map((season) => season.seasonNumber)).toEqual([1])
    expect(flat.episodes[1]?.map((episode) => episode.id)).toEqual(['a', 'b'])
    const mixed = addonMetaToSeriesDetail(meta({ videos: [{ id: 'a', season: 1 }, { id: 'b' }] }))
    expect(mixed.episodes[1]?.map((episode) => episode.id)).toEqual(['a'])
  })

  it('gives each episode an add-on target and a display channel without a URL', () => {
    const episode = defined(detail.episodes[1]?.[1])
    const target = addonEpisodeTarget('ek', 'tt0000009', episode)
    expect(target).toEqual({ kind: 'addon', sourceId: 'ek', contentType: 'series', metaId: 'tt0000009', videoId: 'tt9:1:2' })
    expect(mediaKey(target)).toBe('addon:ek:tt9%3A1%3A2')
    expect(addonEpisodeChannel({ sourceId: 'ek', seriesName: 'Örnek Dizi', episode })).toEqual({
      id: 'ek_episode_tt9%3A1%3A2',
      name: 'Örnek Dizi - S1E2 - Bir-iki',
      streamUrl: '',
      sourceId: 'ek',
      type: 'vod'
    })
  })
})

describe('loadAddonMeta', () => {
  it('asks the catalogue add-on when it serves metas for the id', async () => {
    const fetchImpl = routeFetch({
      [`${CATALOG_BASE}/meta/series/tt0000009.json`]: () => jsonResponse({ meta: { id: 'tt0000009', type: 'series', name: 'Örnek Dizi' } })
    })
    expect((await loadAddonMeta(catalogSource(), 'series', 'tt0000009', { fetchImpl }))?.name).toBe('Örnek Dizi')
  })

  it('asks nothing when the add-on has no meta resource for it', async () => {
    const fetchImpl = vi.fn()
    expect(await loadAddonMeta(catalogSource(), 'series', 'yt:abc', { fetchImpl })).toBeNull()
    expect(await loadAddonMeta(streamSource(), 'movie', 'tt1', { fetchImpl })).toBeNull()
    expect(await loadAddonMeta(catalogSource({ url: undefined }), 'movie', 'tt1', { fetchImpl })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
