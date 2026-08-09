import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createWatchProgressSlice, type WatchProgressSlice } from './watch-progress-slice'
import type { Channel } from '@/types/playlist'

function createTestStore() {
  return create<WatchProgressSlice>()((...args) => createWatchProgressSlice(...args))
}

const movie: Channel = {
  id: 'vod_1',
  name: 'Bir Film',
  streamUrl: 'http://host/movie/1.mkv',
  sourceId: 's1',
  type: 'vod'
}

describe('watch-progress-slice', () => {
  it('stores a position once past the opening seconds', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(movie, 900, 5400)

    const [entry] = store.getState().watchProgress
    expect(entry.key).toBe(movie.streamUrl)
    expect(entry.position).toBe(900)
    expect(entry.channel.name).toBe('Bir Film')
  })

  it('never tracks live channels', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress({ ...movie, type: 'live' }, 900, 5400)

    expect(store.getState().watchProgress).toEqual([])
  })

  it('retires an entry once the title is finished', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().saveWatchProgress(movie, 5300, 5400)

    expect(store.getState().watchProgress).toEqual([])
  })

  it('leaves a stored position alone when the new one is too early to count', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(movie, 900, 5400)
    // Reopening the title reports 0 before the resume seek lands — that must not
    // wipe the position the resume is about to use.
    store.getState().saveWatchProgress(movie, 2, 5400)

    expect(store.getState().watchProgress[0].position).toBe(900)
  })

  it('keeps one entry per stream and moves it to the front', () => {
    const store = createTestStore()
    const other: Channel = { ...movie, id: 'vod_2', streamUrl: 'http://host/movie/2.mkv' }

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().saveWatchProgress(other, 900, 5400)
    store.getState().saveWatchProgress(movie, 1200, 5400)

    const list = store.getState().watchProgress
    expect(list).toHaveLength(2)
    expect(list[0].key).toBe(movie.streamUrl)
    expect(list[0].position).toBe(1200)
  })

  it('removes and clears entries', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().removeWatchProgress(movie.streamUrl)
    expect(store.getState().watchProgress).toEqual([])

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().clearWatchProgress()
    expect(store.getState().watchProgress).toEqual([])
  })
})
