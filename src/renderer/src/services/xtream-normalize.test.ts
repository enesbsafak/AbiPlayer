import { describe, expect, it } from 'vitest'
import { XtreamRequestError } from './xtream-errors'
import {
  normalizeXtreamAuthResponse,
  normalizeXtreamCategories,
  normalizeXtreamLiveStreams,
  normalizeXtreamSeries,
  normalizeXtreamSeriesInfo,
  normalizeXtreamVodInfo,
  normalizeXtreamVodStreams,
  parseXtreamTimestamp,
  toXtreamBoolean,
  toXtreamId,
  toXtreamList,
  toXtreamNumber,
  toXtreamString
} from './xtream-normalize'
import { xtreamApi } from './xtream-api'

function errorOf(fn: () => unknown): XtreamRequestError {
  try {
    fn()
  } catch (error) {
    if (error instanceof XtreamRequestError) return error
    throw error
  }
  throw new Error('expected a throw')
}

describe('scalar coercion', () => {
  it('coerces flags sent as strings, numbers or booleans', () => {
    for (const truthy of ['1', 1, true, 'true', ' TRUE ', 'yes']) expect(toXtreamBoolean(truthy)).toBe(true)
    for (const falsy of ['0', 0, false, '', null, undefined, 'false', 2]) expect(toXtreamBoolean(falsy)).toBe(false)
  })

  it('coerces numbers sent as strings and falls back for junk', () => {
    expect(toXtreamNumber('42')).toBe(42)
    expect(toXtreamNumber(' 3.5 ')).toBe(3.5)
    expect(toXtreamNumber('')).toBe(0)
    expect(toXtreamNumber(null, 7)).toBe(7)
    expect(toXtreamNumber('abc', 7)).toBe(7)
    expect(toXtreamNumber(Number.NaN, 7)).toBe(7)
  })

  it('accepts only positive integer ids', () => {
    expect(toXtreamId('15')).toBe(15)
    expect(toXtreamId(15)).toBe(15)
    expect(toXtreamId('0')).toBeNull()
    expect(toXtreamId('1.5')).toBeNull()
    expect(toXtreamId(null)).toBeNull()
  })

  it('turns any text field into a string', () => {
    expect(toXtreamString('Kanal')).toBe('Kanal')
    expect(toXtreamString(2024)).toBe('2024')
    expect(toXtreamString(null)).toBe('')
    expect(toXtreamString({ nested: true })).toBe('')
  })

  it('parses unix-second timestamps', () => {
    expect(parseXtreamTimestamp('1700000000')).toBe(1_700_000_000)
    expect(parseXtreamTimestamp(1_700_000_000)).toBe(1_700_000_000)
    expect(parseXtreamTimestamp('')).toBeNull()
    expect(parseXtreamTimestamp('0')).toBeNull()
  })
})

describe('toXtreamList', () => {
  it('passes arrays through and unwraps index-keyed objects', () => {
    expect(toXtreamList([1, 2], 'x')).toEqual([1, 2])
    expect(toXtreamList({ 0: 'a', 1: 'b' }, 'x')).toEqual(['a', 'b'])
    expect(toXtreamList({}, 'x')).toEqual([])
  })

  it('rejects anything else as a bad response', () => {
    for (const raw of [null, 'html', 5, { error: 'x' }]) {
      expect(errorOf(() => toXtreamList(raw, 'kanal')).kind).toBe('bad-response')
    }
  })

  it('reports an auth error when the panel answers a list call with a rejected login', () => {
    const error = errorOf(() => toXtreamList({ user_info: { auth: 0 } }, 'kanal'))
    expect(error.kind).toBe('auth')
    expect(error.message).toContain('Kimlik doğrulama başarısız')
  })
})

describe('normalizeXtreamAuthResponse', () => {
  it('coerces the auth flag and output formats', () => {
    const auth = normalizeXtreamAuthResponse({
      user_info: { auth: '1', exp_date: null, max_connections: 2, allowed_output_formats: 'M3U8, ts' },
      server_info: null
    })
    expect(auth.user_info.auth).toBe(1)
    expect(auth.user_info.exp_date).toBe('')
    expect(auth.user_info.max_connections).toBe('2')
    expect(auth.user_info.allowed_output_formats).toEqual(['m3u8', 'ts'])
    expect(auth.server_info.url).toBe('')
  })

  it('maps a rejected login to auth 0', () => {
    expect(normalizeXtreamAuthResponse({ user_info: { auth: 0 } }).user_info.auth).toBe(0)
    expect(normalizeXtreamAuthResponse({ user_info: {} }).user_info.auth).toBe(0)
  })

  it('throws a bad response without user_info', () => {
    expect(errorOf(() => normalizeXtreamAuthResponse({})).kind).toBe('bad-response')
    expect(errorOf(() => normalizeXtreamAuthResponse('x')).kind).toBe('bad-response')
  })
})

describe('list normalizers', () => {
  it('normalizes live streams sent with string fields and drops entries without an id', () => {
    const streams = normalizeXtreamLiveStreams([
      {
        stream_id: '101', name: null, num: '3', is_adult: '1', tv_archive: '1',
        tv_archive_duration: '7', category_id: 12, category_ids: ['12', 'x'], added: 1700000000
      },
      { stream_id: null, name: 'Kimliksiz' },
      'junk'
    ])

    expect(streams).toHaveLength(1)
    expect(streams[0]).toMatchObject({
      stream_id: 101, name: '', num: 3, is_adult: true, tv_archive: true,
      tv_archive_duration: 7, category_id: '12', category_ids: [12], added: '1700000000'
    })
  })

  it('keeps tv archive on when the panel sends "1" instead of 1', () => {
    const streams = normalizeXtreamLiveStreams([{ stream_id: 1, name: 'Arşivli', tv_archive: '1' }])
    const [channel] = xtreamApi.liveStreamsToRecords(streams, 's')
    expect(channel?.tvArchive).toBe(true)
  })

  it('normalizes VOD streams and strips a leading dot from the extension', () => {
    const [vod] = normalizeXtreamVodStreams([
      { stream_id: '9', name: 2012, rating: 7.4, container_extension: '.mkv', is_adult: 0 }
    ])
    expect(vod).toMatchObject({ stream_id: 9, name: '2012', rating: '7.4', container_extension: 'mkv', is_adult: false })
  })

  it('normalizes series and accepts a single backdrop string', () => {
    const [series] = normalizeXtreamSeries([
      { series_id: '4', name: 'Dizi', backdrop_path: 'http://img/b.jpg', last_modified: 1690000000 }
    ])
    expect(series).toMatchObject({ series_id: 4, name: 'Dizi', backdrop_path: ['http://img/b.jpg'], last_modified: '1690000000' })
  })

  it('normalizes categories and drops those without an id', () => {
    expect(
      normalizeXtreamCategories([
        { category_id: 5, category_name: 'Spor', parent_id: '0' },
        { category_name: 'Kimliksiz' }
      ])
    ).toEqual([{ category_id: '5', category_name: 'Spor', parent_id: 0 }])
  })
})

describe('detail normalizers', () => {
  it('fills VOD info when the panel answers "info": []', () => {
    const info = normalizeXtreamVodInfo({ info: [], movie_data: { stream_id: '3' } })
    expect(info.info.name).toBe('')
    expect(info.info.plot).toBe('')
    expect(info.movie_data.stream_id).toBe(3)
  })

  it('uses alternative VOD info keys some panels send', () => {
    const info = normalizeXtreamVodInfo({
      info: { description: 'Konu', releasedate: '2019-01-01', cover_big: 'http://img/c.jpg', tmdb_id: 603 }
    })
    expect(info.info).toMatchObject({
      plot: 'Konu', release_date: '2019-01-01', movie_image: 'http://img/c.jpg', tmdb_id: '603'
    })
  })

  it('guarantees the top-level series info shape', () => {
    expect(normalizeXtreamSeriesInfo({ info: [], episodes: null })).toEqual({ seasons: [], info: {}, episodes: {} })
    expect(errorOf(() => normalizeXtreamSeriesInfo(null)).kind).toBe('bad-response')
  })
})
