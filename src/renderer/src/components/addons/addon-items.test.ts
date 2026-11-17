import { afterEach, describe, expect, it } from 'vitest'
import { planCatalogItemOpen } from '@/hooks/useOpenCatalogItem'
import { isPlayableChannel } from '@/services/playback'
import { chooseAddonStream, forgetAddonStreams, registerAddonStreamUrl } from '@/addons/stream-registry'
import { STREAM_URL } from '@/addons/testing/fixtures'
import {
  channelFromFavoriteSnapshot,
  favoriteSnapshotOf,
  isM3uSnapshotChannel,
  sanitizeFavoriteSnapshot
} from '@/store/favorites-slice'
import { resolveFavoriteChannels } from '@/components/favorites/favorite-channels'
import { seasonLabel } from '@/components/series/SeriesDetail'
import { initialSeasonOf, seriesDetailFromCard, withCardFallback } from '@/components/series/AddonSeriesDetail'
import { addonMetaToSeriesDetail } from '@/addons/detail'
import type { AddonMeta } from '@/addons/client'
import type { Channel } from '@/types/playlist'
import { addonTarget } from '../../../../shared/playback'
import { resolveDetailItem } from './detail-item'

const film: Channel = {
  id: 'ek_vod_populer/tt0000001',
  name: 'Örnek Film',
  streamUrl: '',
  sourceId: 'ek',
  type: 'vod',
  addonMetaId: 'tt0000001',
  categoryId: 'ek_vod_populer',
  categoryName: 'Popüler Filmler',
  coverUrl: 'https://img.addon.example/1.jpg',
  year: '2021'
}
const series: Channel = { ...film, id: 'ek_series_yeni/tt0000002', name: 'Örnek Dizi', type: 'series', addonMetaId: 'tt0000002' }

afterEach(() => forgetAddonStreams())

describe('opening an add-on item from home, search or favourites', () => {
  it('opens its detail on its page, where its stream is chosen', () => {
    expect(planCatalogItemOpen(film)).toEqual({
      kind: 'addon-detail',
      path: '/vod',
      state: { restoreDetail: { itemId: film.id, sourceId: 'ek', addonMetaId: 'tt0000001' } }
    })
    expect(planCatalogItemOpen(series, { seriesRouteState: { restoreSearchQuery: 'örnek' } })).toEqual({
      kind: 'addon-detail',
      path: '/series',
      state: { restoreSearchQuery: 'örnek', restoreDetail: { itemId: series.id, sourceId: 'ek', addonMetaId: 'tt0000002' } }
    })
  })

  it('is playable directly (previous/next, the player list) only once a stream was chosen in this session', () => {
    expect(isPlayableChannel(film)).toBe(false)
    const target = addonTarget({ sourceId: 'ek', contentType: 'movie', metaId: 'tt0000001' })
    expect(chooseAddonStream(target, registerAddonStreamUrl(target, STREAM_URL))).toBe(true)
    expect(isPlayableChannel(film)).toBe(true)
  })
})

describe('favourites of add-on items', () => {
  it('survive a reload with their meta id and no URL, and open their detail', () => {
    const stored = JSON.parse(JSON.stringify(favoriteSnapshotOf(film))) as unknown
    const snapshot = sanitizeFavoriteSnapshot(stored)
    expect(snapshot).toMatchObject({ id: film.id, addonMetaId: 'tt0000001', sourceId: 'ek', type: 'vod' })
    expect(snapshot).not.toHaveProperty('m3u')
    const card = channelFromFavoriteSnapshot(snapshot!)
    expect(isM3uSnapshotChannel(card)).toBe(false)
    expect(planCatalogItemOpen(card).kind).toBe('addon-detail')
  })

  it('are left out like other favourites once their add-on is removed', () => {
    const snapshot = favoriteSnapshotOf(series)
    const shown = resolveFavoriteChannels(new Set([series.id]), { [series.id]: snapshot }, () => undefined, new Set(['baska']))
    expect(shown).toEqual([])
  })
})

describe('the item an add-on detail shows', () => {
  const detail = { itemId: film.id, sourceId: 'ek', addonMetaId: 'tt0000001' }

  it('is the card clicked, the catalog record, the favourite snapshot, or a bare record with the meta id', () => {
    expect(resolveDetailItem(detail, 'vod', film, undefined, undefined)).toBe(film)
    expect(resolveDetailItem(detail, 'vod', null, film, undefined)).toBe(film)
    expect(resolveDetailItem(detail, 'vod', null, undefined, favoriteSnapshotOf(film))).toMatchObject({ name: 'Örnek Film' })
    expect(resolveDetailItem(detail, 'vod', null, undefined, undefined)).toEqual({
      id: film.id,
      name: '',
      streamUrl: '',
      sourceId: 'ek',
      type: 'vod',
      addonMetaId: 'tt0000001'
    })
    // An Xtream detail without its record shows nothing until the record is in.
    expect(resolveDetailItem({ itemId: 'x', sourceId: 'p' }, 'vod', null, undefined, undefined)).toBeNull()
  })
})

describe('an add-on series detail', () => {
  const meta: AddonMeta = {
    id: 'tt0000002',
    type: 'series',
    name: '',
    poster: null,
    background: null,
    year: null,
    releaseInfo: null,
    rating: null,
    description: 'Bir dizi.',
    genres: ['Dram'],
    cast: ['Ayşe'],
    director: [],
    runtime: null,
    videos: [
      { id: 'tt0000002:0:1', title: 'Kamera arkası', season: 0, episode: 1, released: null, thumbnail: null, overview: null },
      { id: 'tt0000002:2:1', title: 'Dönüş', season: 2, episode: 1, released: null, thumbnail: null, overview: null },
      { id: 'tt0000002:1:1', title: 'Başlangıç', season: 1, episode: 1, released: null, thumbnail: null, overview: null }
    ]
  }

  it('names season 0 "Özel bölümler" and lists it last', () => {
    const detail = addonMetaToSeriesDetail(meta)
    expect(detail.seasons.map(seasonLabel)).toEqual(['Sezon 1', 'Sezon 2', 'Özel bölümler'])
  })

  it('opens on the season asked for when the series has it, else the first', () => {
    const detail = addonMetaToSeriesDetail(meta)
    expect(initialSeasonOf(detail, 0)).toBe(0)
    expect(initialSeasonOf(detail, 7)).toBe(1)
    expect(initialSeasonOf(seriesDetailFromCard(series), undefined)).toBe(1)
  })

  it('keeps what the card knows where the meta says nothing', () => {
    const detail = withCardFallback(addonMetaToSeriesDetail(meta), series)
    expect(detail).toMatchObject({ name: 'Örnek Dizi', cover: series.coverUrl, releaseDate: '2021', plot: 'Bir dizi.', cast: 'Ayşe' })
    expect(seriesDetailFromCard(series)).toMatchObject({ name: 'Örnek Dizi', seasons: [], episodes: {} })
  })
})
