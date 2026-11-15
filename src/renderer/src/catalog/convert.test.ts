import { describe, expect, it } from 'vitest'
import { normalizeSearchText } from '@/services/text-normalize'
import { parseM3U } from '@/services/m3u-parser'
import { defined } from '../../../shared/checked'
import { targetFromCatalogItem } from '../../../shared/playback'
import type { XtreamSeriesStream, XtreamVODStream } from '@/types/xtream'
import {
  m3uPlaylistToReplacement,
  xtreamCategoriesToRecords,
  xtreamLiveToRecords,
  xtreamSeriesToRecords,
  xtreamVodToRecords
} from './convert'
import { normalizeSearchKey } from './normalize'

describe('normalizeSearchKey', () => {
  it('matches normalizeSearchText, with and without the ASCII fast path', () => {
    for (const sample of ['IZLE', 'İzle', 'ızgara', 'Şahin TV', 'TRT 1 HD', 'Ünlü', 'Mix\tCase', '', 'ÇOCUK']) {
      expect(normalizeSearchKey(sample)).toBe(normalizeSearchText(sample))
    }
    expect(normalizeSearchKey(undefined)).toBe('')
  })
})

describe('Xtream converters', () => {
  it('builds compact live records with ids, timestamps and no URL', () => {
    const [record] = xtreamLiveToRecords(
      [
        {
          num: 1, name: 'TRT 1', stream_type: 'live', stream_id: 10, stream_icon: 'http://img/1.png',
          epg_channel_id: 'trt1.tr', added: '1700000000', is_adult: false, category_id: '5', category_ids: [5],
          custom_sid: '', tv_archive: true, direct_source: '', tv_archive_duration: 3
        }
      ],
      'src'
    )
    expect(record).toEqual({
      id: 'src_live_10',
      name: 'TRT 1',
      streamUrl: '',
      streamId: 10,
      sourceId: 'src',
      type: 'live',
      searchName: 'trt 1',
      isAdult: false,
      logo: 'http://img/1.png',
      categoryId: 'src_live_5',
      epgChannelId: 'trt1.tr',
      tvArchive: true,
      tvArchiveDuration: 3,
      added: 1_700_000_000
    })
    expect(targetFromCatalogItem(defined(record, 'record'))).toEqual({ kind: 'live', sourceId: 'src', streamId: 10 })
  })

  it('gives films the container extension playback needs, mp4 by default', () => {
    const vod = (extension: string): XtreamVODStream => ({
      num: 1, name: 'Film', stream_type: 'movie', stream_id: 7, stream_icon: '', rating: '7.1', rating_5based: 3.5,
      added: '', is_adult: false, category_id: '', category_ids: [], container_extension: extension, custom_sid: '',
      direct_source: ''
    })
    const [mkv] = xtreamVodToRecords([vod('mkv')], 'src')
    const [fallback] = xtreamVodToRecords([vod('')], 'src')
    expect(mkv).toMatchObject({ id: 'src_vod_7', containerExtension: 'mkv', rating: '7.1', streamUrl: '' })
    expect(mkv).not.toHaveProperty('added')
    expect(fallback?.containerExtension).toBe('mp4')
    expect(targetFromCatalogItem(defined(mkv, 'mkv'))).toMatchObject({ kind: 'movie', streamId: 7, containerExtension: 'mkv' })
  })

  it('keeps series detail text out of the list records', () => {
    const series: XtreamSeriesStream = {
      num: 1, name: 'Dizi', series_id: 4, cover: 'http://img/c.jpg', plot: 'Uzun özet', cast: 'Oyuncular',
      director: 'Yönetmen', genre: 'Dram', release_date: '2020', last_modified: '1690000000', rating: '8',
      rating_5based: 4, backdrop_path: ['http://img/b.jpg'], youtube_trailer: '', episode_run_time: '45',
      category_id: '2', category_ids: [2]
    }
    const [record] = xtreamSeriesToRecords([series], 'src')
    expect(record).toEqual({
      id: 'src_series_4',
      name: 'Dizi',
      streamUrl: '',
      seriesId: 4,
      sourceId: 'src',
      type: 'series',
      searchName: 'dizi',
      isAdult: false,
      logo: 'http://img/c.jpg',
      categoryId: 'src_series_2',
      rating: '8',
      lastModified: 1_690_000_000
    })
  })

  it('flags adult content once, from the provider flag or the name', () => {
    const records = xtreamLiveToRecords(
      [
        { name: 'Kanal', is_adult: true },
        { name: 'XXX Gece', is_adult: false },
        { name: 'Adult Swim', is_adult: false }
      ].map((extra, i) => ({
        num: i, stream_type: 'live', stream_id: i, stream_icon: '', epg_channel_id: '', added: '',
        category_id: '', category_ids: [], custom_sid: '', tv_archive: false, direct_source: '',
        tv_archive_duration: 0, ...extra
      })),
      'src'
    )
    expect(records.map((record) => record.isAdult)).toEqual([true, true, false])
    expect(
      xtreamCategoriesToRecords([{ category_id: '9', category_name: 'YETİŞKİN', parent_id: 0 }], 'src', 'vod')
    ).toEqual([{ id: 'src_vod_9', name: 'YETİŞKİN', sourceId: 'src', type: 'vod', isAdult: true }])
  })
})

describe('M3U converters', () => {
  const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="haber.tr" tvg-logo="http://img/h.png" group-title="Haber",Haber TV
http://cdn.test/haber.m3u8
#EXTINF:-1 group-title="Filmler",Film
http://cdn.test/movie/film.mp4
#EXTINF:-1 group-title="XXX",Gece
http://cdn.test/gece.m3u8`

  it('keeps the entry URL as identity and never adds a stream id', () => {
    const replacement = m3uPlaylistToReplacement(parseM3U(playlist, 'm'))
    const [haber] = replacement.live!.items
    expect(haber).toMatchObject({
      name: 'Haber TV',
      streamUrl: 'http://cdn.test/haber.m3u8',
      group: 'Haber',
      categoryName: 'Haber',
      searchGroup: 'haber',
      epgChannelId: 'haber.tr'
    })
    expect(haber).not.toHaveProperty('streamId')
    expect(targetFromCatalogItem(defined(haber, 'haber'))?.kind).toBe('m3u')
  })

  it('splits the playlist into complete lists per type, categories included', () => {
    const replacement = m3uPlaylistToReplacement(parseM3U(playlist, 'm'))
    expect(replacement.live!.items.map((item) => item.name)).toEqual(['Haber TV', 'Gece'])
    expect(replacement.vod!.items.map((item) => item.name)).toEqual(['Film'])
    expect(replacement.series!.items).toEqual([])
    expect(replacement.live!.categories.map((category) => [category.name, category.isAdult])).toEqual([
      ['Haber', false],
      ['XXX', true]
    ])
    expect(replacement.live!.items[1]?.isAdult).toBe(true)
  })
})
