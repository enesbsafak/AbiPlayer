// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addonTarget,
  isLiveTarget,
  isMediaKey,
  isPlayableTarget,
  isTrackableTarget,
  mediaKey,
  sanitizePlaybackTarget,
  targetFromCatalogItem
} from './target'

const episode = addonTarget({ sourceId: 'eklenti_1', contentType: 'series', metaId: 'tt0000001', videoId: 'tt0000001:2:5' })

describe('add-on playback target', () => {
  it('keys a video by kind, source and encoded video id, in the usual three-part shape', () => {
    const key = mediaKey(episode)
    expect(key).toBe('addon:eklenti_1:tt0000001%3A2%3A5')
    expect(isMediaKey(key)).toBe(true)
    expect(key.split(':')).toHaveLength(3)
  })

  it('plays a film by its meta id', () => {
    const film = addonTarget({ sourceId: 's', contentType: 'movie', metaId: 'ornek-film' })
    expect(film.videoId).toBe('ornek-film')
    expect(mediaKey(film)).toBe('addon:s:ornek-film')
  })

  it('is playable and trackable, never live', () => {
    expect(isPlayableTarget(episode)).toBe(true)
    expect(isLiveTarget(episode)).toBe(false)
    expect(isTrackableTarget(episode)).toBe(true)
  })

  it('survives storage and rejects malformed ones', () => {
    expect(sanitizePlaybackTarget(JSON.parse(JSON.stringify(episode)))).toEqual(episode)
    expect(sanitizePlaybackTarget({ ...episode, contentType: 'tv' })).toBeNull()
    expect(sanitizePlaybackTarget({ ...episode, videoId: '' })).toBeNull()
    expect(sanitizePlaybackTarget({ ...episode, metaId: 'a\u0000b' })).toBeNull()
    expect(sanitizePlaybackTarget({ ...episode, videoId: 'x'.repeat(600) })).toBeNull()
    // Whatever else a stored copy carries is not kept.
    expect(sanitizePlaybackTarget({ ...episode, url: 'https://addon.example/gizli/v.mp4' })).not.toHaveProperty('url')
  })

  it('is what an add-on film card plays; an add-on series card plays nothing itself', () => {
    expect(targetFromCatalogItem({ sourceId: 's', type: 'vod', addonMetaId: 'tt0000002', streamUrl: '' })).toEqual(
      addonTarget({ sourceId: 's', contentType: 'movie', metaId: 'tt0000002' })
    )
    expect(targetFromCatalogItem({ sourceId: 's', type: 'series', addonMetaId: 'tt0000003', streamUrl: '' })).toBeNull()
  })
})
