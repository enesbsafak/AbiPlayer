import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import type { Channel } from '@/types/playlist'

function createTestStore() {
  return create<PlaylistSlice>()((...args) => createPlaylistSlice(...args))
}

function createPlayerTestStore() {
  return create<PlayerSlice>()((...args) => createPlayerSlice(...args))
}

describe('playlist-slice', () => {
  it('keeps the selected category when the same filter is set again', () => {
    const store = createTestStore()

    store.getState().setSelectedCategory('source_live_10')
    store.getState().setChannelFilter('live')

    expect(store.getState().selectedCategoryId).toBe('source_live_10')
  })

  it('clears the selected category when the filter actually changes', () => {
    const store = createTestStore()

    store.getState().setSelectedCategory('source_live_10')
    store.getState().setChannelFilter('vod')

    expect(store.getState().selectedCategoryId).toBeNull()
    expect(store.getState().channelFilter).toBe('vod')
  })
})

describe('player-slice', () => {
  it('resets video quality state when playback changes or stops', () => {
    const store = createPlayerTestStore()
    const channel: Channel = {
      id: 'vod_1',
      name: 'Film 1080p',
      streamUrl: 'https://cdn.example.com/movie.m3u8',
      sourceId: 'source_1',
      type: 'vod'
    }

    store.getState().setVideoQualityOptions([
      { id: 'auto', label: 'Otomatik', shortLabel: 'Oto', auto: true },
      { id: 'hls-v:0', label: '1080p · 5.6 Mbps', shortLabel: '1080p', height: 1080, bitrate: 5_600_000 }
    ])
    store.getState().setCurrentVideoQuality('hls-v:0')
    store.getState().setActiveVideoQuality('hls-v:0')

    store.getState().playChannel(channel)

    expect(store.getState().videoQualityOptions).toEqual([])
    expect(store.getState().currentVideoQuality).toBeNull()
    expect(store.getState().activeVideoQuality).toBeNull()

    store.getState().setVideoQualityOptions([
      { id: 'auto', label: 'Otomatik', shortLabel: 'Oto', auto: true }
    ])
    store.getState().setCurrentVideoQuality('auto')
    store.getState().setActiveVideoQuality('hls-v:0')

    store.getState().stopPlayback()

    expect(store.getState().videoQualityOptions).toEqual([])
    expect(store.getState().currentVideoQuality).toBeNull()
    expect(store.getState().activeVideoQuality).toBeNull()
  })
})
