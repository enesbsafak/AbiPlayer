import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import type { Category, Channel } from '@/types/playlist'

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

describe('playlist-slice category visibility', () => {
  const categories: Category[] = [
    { id: 's1_live_1', name: 'Ulusal', sourceId: 's1', type: 'live' },
    { id: 's1_live_2', name: 'XXX', sourceId: 's1', type: 'live' },
    { id: 's2_live_1', name: 'Haber', sourceId: 's2', type: 'live' }
  ]

  it('toggles a category between hidden and visible', () => {
    const store = createTestStore()

    store.getState().toggleCategoryHidden('s1_live_2')
    expect(store.getState().hiddenCategoryIds.has('s1_live_2')).toBe(true)

    store.getState().toggleCategoryHidden('s1_live_2')
    expect(store.getState().hiddenCategoryIds.has('s1_live_2')).toBe(false)
  })

  it('drops the selection when the browsed category gets hidden', () => {
    const store = createTestStore()

    store.getState().setSelectedCategory('s1_live_2')
    store.getState().toggleCategoryHidden('s1_live_2')

    expect(store.getState().selectedCategoryId).toBeNull()
  })

  it('keeps the selection when a different category gets hidden', () => {
    const store = createTestStore()

    store.getState().setSelectedCategory('s1_live_1')
    store.getState().toggleCategoryHidden('s1_live_2')

    expect(store.getState().selectedCategoryId).toBe('s1_live_1')
  })

  it('restores only the requested source when showing all', () => {
    const store = createTestStore()
    store.getState().setCategories(categories)
    store.getState().setHiddenCategories(['s1_live_2', 's2_live_1'])

    store.getState().showAllCategories('s1')

    expect(store.getState().hiddenCategoryIds).toEqual(new Set(['s2_live_1']))
  })

  it('restores every source when no source is given', () => {
    const store = createTestStore()
    store.getState().setCategories(categories)
    store.getState().setHiddenCategories(['s1_live_2', 's2_live_1'])

    store.getState().showAllCategories()

    expect(store.getState().hiddenCategoryIds.size).toBe(0)
  })

  it('forgets hidden entries when their source is removed', () => {
    const store = createTestStore()
    store.getState().setCategories(categories)
    store.getState().setHiddenCategories(['s1_live_2', 's2_live_1'])

    store.getState().removeCategoriesBySource('s1')

    expect(store.getState().hiddenCategoryIds).toEqual(new Set(['s2_live_1']))
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
