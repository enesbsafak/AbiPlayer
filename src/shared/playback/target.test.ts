import { describe, expect, it } from 'vitest'
import {
  createPlaybackId,
  episodeTarget,
  isLiveTarget,
  isMediaKey,
  isPlayableTarget,
  isTrackableTarget,
  m3uEntryId,
  mediaKey,
  sanitizePlaybackTarget,
  stableHash,
  targetFromCatalogItem,
  type PlaybackTarget
} from './index'

describe('mediaKey', () => {
  it('includes the source, so two accounts on one host never share an entry', () => {
    const a = mediaKey({ kind: 'movie', sourceId: 'account-a', streamId: 7, containerExtension: 'mp4' })
    const b = mediaKey({ kind: 'movie', sourceId: 'account-b', streamId: 7, containerExtension: 'mp4' })
    expect(a).not.toBe(b)
  })

  it('ignores the container extension', () => {
    expect(mediaKey({ kind: 'movie', sourceId: 's', streamId: 7, containerExtension: 'mp4' })).toBe(
      mediaKey({ kind: 'movie', sourceId: 's', streamId: 7, containerExtension: 'mkv' })
    )
  })

  it('keeps a series and an episode with the same number apart', () => {
    const series = mediaKey({ kind: 'series', sourceId: 's', seriesId: 5 })
    const episode = mediaKey(episodeTarget({ sourceId: 's', episodeId: 5 }))
    expect(series).not.toBe(episode)
  })

  it('never contains a URL or a credential', () => {
    const url = 'http://host.example/live/user/secret/9.ts'
    const key = mediaKey({ kind: 'm3u', sourceId: 'src', entryId: m3uEntryId(url), mediaType: 'vod' })
    expect(key).not.toContain('http')
    expect(key).not.toContain('secret')
    expect(key).not.toContain('user')
    expect(isMediaKey(key)).toBe(true)
  })

  it('escapes separators in the source id', () => {
    const key = mediaKey({ kind: 'live', sourceId: 'a:b', streamId: 1 })
    expect(key).toBe('live:a%3Ab:1')
    expect(isMediaKey(key)).toBe(true)
  })

  it('tells media keys from legacy URL keys', () => {
    expect(isMediaKey('http://host/movie/~abi~/~abi~/1.mp4')).toBe(false)
    expect(isMediaKey('movie:s:1')).toBe(true)
  })
})

describe('stableHash', () => {
  it('is deterministic and 14 hex digits', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'))
    expect(stableHash('abc')).toMatch(/^[0-9a-f]{14}$/)
    expect(stableHash('abc')).not.toBe(stableHash('abd'))
  })

  it('treats surrounding whitespace of an entry URL as the same entry', () => {
    expect(m3uEntryId(' http://a/b.ts\n')).toBe(m3uEntryId('http://a/b.ts'))
  })
})

describe('targetFromCatalogItem', () => {
  it('maps Xtream live and film items by their provider id', () => {
    expect(targetFromCatalogItem({ sourceId: 's', type: 'live', streamId: 3, streamUrl: 'http://x' })).toEqual({
      kind: 'live',
      sourceId: 's',
      streamId: 3
    })
    expect(
      targetFromCatalogItem({ sourceId: 's', type: 'vod', streamId: 4, containerExtension: 'MKV' })
    ).toEqual({ kind: 'movie', sourceId: 's', streamId: 4, containerExtension: 'mkv' })
  })

  it('defaults a missing film extension to mp4, as the URL builder does', () => {
    expect(targetFromCatalogItem({ sourceId: 's', type: 'vod', streamId: 4 })).toMatchObject({
      containerExtension: 'mp4'
    })
  })

  it('keeps a series container distinct and unplayable', () => {
    const target = targetFromCatalogItem({ sourceId: 's', type: 'series', seriesId: 9, streamUrl: '' })
    expect(target).toEqual({ kind: 'series', sourceId: 's', seriesId: 9 })
    expect(isPlayableTarget(target!)).toBe(false)
  })

  it('treats an item without a provider id as an M3U entry keyed by its URL', () => {
    const target = targetFromCatalogItem({
      sourceId: 's',
      type: 'vod',
      streamUrl: 'http://host/movie/u/p/1.mp4'
    })
    expect(target).toEqual({
      kind: 'm3u',
      sourceId: 's',
      entryId: m3uEntryId('http://host/movie/u/p/1.mp4'),
      mediaType: 'vod'
    })
  })

  it('returns null when nothing identifies the item', () => {
    expect(targetFromCatalogItem({ sourceId: 's', type: 'vod', streamUrl: '' })).toBeNull()
  })
})

describe('target classification', () => {
  it('only tracks films and episodes', () => {
    const live: PlaybackTarget = { kind: 'live', sourceId: 's', streamId: 1 }
    const m3uLive: PlaybackTarget = { kind: 'm3u', sourceId: 's', entryId: 'abcdef12', mediaType: 'live' }
    const m3uFilm: PlaybackTarget = { kind: 'm3u', sourceId: 's', entryId: 'abcdef12', mediaType: 'vod' }
    expect(isLiveTarget(live)).toBe(true)
    expect(isLiveTarget(m3uLive)).toBe(true)
    expect(isTrackableTarget(live)).toBe(false)
    expect(isTrackableTarget(m3uLive)).toBe(false)
    expect(isTrackableTarget(m3uFilm)).toBe(true)
    expect(isTrackableTarget(episodeTarget({ sourceId: 's', episodeId: 2 }))).toBe(true)
    expect(isTrackableTarget({ kind: 'series', sourceId: 's', seriesId: 2 })).toBe(false)
  })
})

describe('sanitizePlaybackTarget', () => {
  it('round-trips every kind', () => {
    const targets: PlaybackTarget[] = [
      { kind: 'live', sourceId: 's', streamId: 1 },
      { kind: 'movie', sourceId: 's', streamId: 2, containerExtension: 'mkv' },
      episodeTarget({ sourceId: 's', episodeId: 3, seriesId: 4, season: 1, episode: 2 }),
      { kind: 'series', sourceId: 's', seriesId: 5 },
      { kind: 'm3u', sourceId: 's', entryId: m3uEntryId('http://a/b'), mediaType: 'series' }
    ]
    for (const target of targets) {
      expect(sanitizePlaybackTarget(JSON.parse(JSON.stringify(target)))).toEqual(target)
    }
  })

  it('rejects malformed input', () => {
    expect(sanitizePlaybackTarget(null)).toBeNull()
    expect(sanitizePlaybackTarget({ kind: 'movie', sourceId: 's', streamId: '2' })).toBeNull()
    expect(sanitizePlaybackTarget({ kind: 'live', streamId: 2 })).toBeNull()
    expect(sanitizePlaybackTarget({ kind: 'm3u', sourceId: 's', entryId: 'http://x', mediaType: 'vod' })).toBeNull()
    expect(sanitizePlaybackTarget({ kind: 'podcast', sourceId: 's' })).toBeNull()
  })
})

describe('createPlaybackId', () => {
  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createPlaybackId()))
    expect(ids.size).toBe(1000)
  })
})
