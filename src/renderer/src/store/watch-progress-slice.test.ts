import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createWatchProgressSlice, type WatchProgressSlice } from './watch-progress-slice'
import type { Channel } from '@/types/playlist'
import type { ProgressSubject, WatchProgressEntry } from '@/services/watch-progress'
import { mediaKey, type PlaybackTarget } from '../../../shared/playback'

function createTestStore() {
  return create<WatchProgressSlice>()((...args) => createWatchProgressSlice(...args))
}

const XTREAM_URL = 'http://host/movie/ahmet/s3cret/1.mkv'
const movieTarget: PlaybackTarget = { kind: 'movie', sourceId: 's1', streamId: 1, containerExtension: 'mkv' }
const movieChannel: Channel = {
  id: 's1_vod_1',
  name: 'Bir Film',
  streamUrl: XTREAM_URL,
  streamId: 1,
  sourceId: 's1',
  type: 'vod'
}
const movie: ProgressSubject = { target: movieTarget, channel: movieChannel, streamUrl: XTREAM_URL }
const movieKey = mediaKey(movieTarget)

describe('watch-progress-slice', () => {
  it('stores a position once past the opening seconds, keyed by media key', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(movie, 900, 5400)

    const [entry] = store.getState().watchProgress
    expect(entry.key).toBe(movieKey)
    expect(entry.target).toEqual(movieTarget)
    expect(entry.position).toBe(900)
    expect(entry.channel.name).toBe('Bir Film')
    // An Xtream URL would put the password into localStorage.
    expect(JSON.stringify(entry)).not.toContain('s3cret')
  })

  it('never tracks live channels', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(
      { target: { kind: 'live', sourceId: 's1', streamId: 3 }, channel: { ...movieChannel, type: 'live' } },
      900,
      5400
    )

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

  it('keeps one entry per item and moves it to the front', () => {
    const store = createTestStore()
    const other: ProgressSubject = {
      target: { ...movieTarget, streamId: 2 },
      channel: { ...movieChannel, id: 's1_vod_2', streamId: 2 }
    }

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().saveWatchProgress(other, 900, 5400)
    store.getState().saveWatchProgress(movie, 1200, 5400)

    const list = store.getState().watchProgress
    expect(list).toHaveLength(2)
    expect(list[0].key).toBe(movieKey)
    expect(list[0].position).toBe(1200)
  })

  it('keeps the same film of two accounts on one host apart', () => {
    const store = createTestStore()
    const sameFilmOtherAccount: ProgressSubject = {
      target: { ...movieTarget, sourceId: 's2' },
      channel: { ...movieChannel, sourceId: 's2' }
    }

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().saveWatchProgress(sameFilmOtherAccount, 300, 5400)

    expect(store.getState().watchProgress.map((entry) => entry.position)).toEqual([300, 900])
  })

  it('takes over an unmigrated legacy entry for the same item instead of duplicating it', () => {
    const store = createTestStore()
    const legacy: WatchProgressEntry = {
      key: 'http://host/movie/~abi~/~abi~/1.mkv',
      target: null,
      position: 600,
      duration: 5400,
      updatedAt: 1,
      channel: { id: 'x', name: 'Bir Film', streamUrl: 'http://host/movie/~abi~/~abi~/1.mkv', sourceId: 's1', type: 'vod' }
    }
    store.setState({ watchProgress: [legacy] })

    store.getState().saveWatchProgress(movie, 900, 5400)

    expect(store.getState().watchProgress.map((entry) => entry.key)).toEqual([movieKey])
  })

  it('removes and clears entries', () => {
    const store = createTestStore()

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().removeWatchProgress(movieKey)
    expect(store.getState().watchProgress).toEqual([])

    store.getState().saveWatchProgress(movie, 900, 5400)
    store.getState().clearWatchProgress()
    expect(store.getState().watchProgress).toEqual([])
  })
})
