import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createPlaylistSlice, type PlaylistSlice } from './playlist-slice'

function createTestStore() {
  return create<PlaylistSlice>()((...args) => createPlaylistSlice(...args))
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
