import { describe, expect, it } from 'vitest'
import type { Channel } from '@/types/playlist'
import { m3uEntryId, mediaKey } from '../../../../shared/playback'
import { isPlayingItem } from './PlayerSidebar'

const xtreamLive: Channel = { id: 's1_live_5', name: 'Kanal', streamUrl: '', streamId: 5, sourceId: 's1', type: 'live' }
const entry: Channel = { id: 'm_ch_1', name: 'Liste', streamUrl: 'http://cdn.test/a.m3u8', sourceId: 'm', type: 'live' }

describe('PlayerSidebar playing-item check', () => {
  it('compares media keys, not stream URLs', () => {
    const playing = mediaKey({ kind: 'live', sourceId: 's1', streamId: 5 })
    expect(isPlayingItem(playing, xtreamLive)).toBe(true)
    // Xtream records carry no URL, so equal (empty) URLs say nothing.
    expect(isPlayingItem(playing, { ...xtreamLive, id: 's1_live_6', streamId: 6 })).toBe(false)
    expect(isPlayingItem(playing, { ...xtreamLive, sourceId: 's2' })).toBe(false)
  })

  it('treats an M3U entry whose URL changed as a different item', () => {
    const keyFor = (url: string) =>
      mediaKey({ kind: 'm3u', sourceId: 'm', entryId: m3uEntryId(url), mediaType: 'live' })
    expect(isPlayingItem(keyFor('http://cdn.test/a.m3u8'), entry)).toBe(true)
    expect(isPlayingItem(keyFor('http://cdn.test/b.m3u8'), entry)).toBe(false)
    expect(isPlayingItem(null, entry)).toBe(false)
  })
})
