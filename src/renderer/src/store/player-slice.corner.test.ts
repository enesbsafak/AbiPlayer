import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import type { Channel } from '@/types/playlist'

function createStore(keepPlayingInCorner: boolean) {
  return create<PlayerSlice & { settings: { keepPlayingInCorner: boolean } }>()((...args) => ({
    ...createPlayerSlice(...args),
    settings: { keepPlayingInCorner }
  }))
}

const live: Channel = {
  id: 'live-1',
  name: 'Kanal',
  streamUrl: 'https://example.com/live/1/index.m3u8',
  sourceId: 'm3u',
  type: 'live'
}

describe('leaving the player route (F2-15, experimental corner player)', () => {
  it('suspends the playback when the setting is off, exactly as before', () => {
    const store = createStore(false)
    store.getState().setPlaybackEngine('mpv')
    store.getState().playChannel(live)
    store.getState().leavePlayerRoute()
    expect(store.getState()).toMatchObject({ isPlaybackSuspended: true, isCornerPlayback: false, isPaused: true })
  })

  it('keeps the very same playback running in the corner with the setting on and mpv', () => {
    const store = createStore(true)
    store.getState().setPlaybackEngine('mpv')
    store.getState().playChannel(live)
    const before = store.getState().currentPlayback
    store.getState().applyPlayerPatch({ currentTime: 42 })

    store.getState().leavePlayerRoute()
    expect(store.getState()).toMatchObject({ isPlaybackSuspended: false, isCornerPlayback: true, currentTime: 42 })
    expect(store.getState().currentPlayback).toBe(before)

    // Coming back to the player keeps it too: no new playback id, nothing reloads.
    store.getState().returnFromCornerPlayback()
    store.getState().resumeSuspendedPlayback()
    expect(store.getState().isCornerPlayback).toBe(false)
    expect(store.getState().currentPlayback).toBe(before)
  })

  it('has no effect with the HTML5 engine: the card behaviour stays', () => {
    const store = createStore(true)
    store.getState().setPlaybackEngine('html5')
    store.getState().playChannel(live)
    store.getState().leavePlayerRoute()
    expect(store.getState()).toMatchObject({ isPlaybackSuspended: true, isCornerPlayback: false })
  })

  it('ends the corner playback with a stop or a new item', () => {
    const store = createStore(true)
    store.getState().setPlaybackEngine('mpv')
    store.getState().playChannel(live)
    store.getState().leavePlayerRoute()
    store.getState().playChannel({ ...live, id: 'live-2', streamUrl: 'https://example.com/live/2/index.m3u8' })
    expect(store.getState().isCornerPlayback).toBe(false)

    store.getState().leavePlayerRoute()
    store.getState().stopPlayback()
    expect(store.getState()).toMatchObject({ isCornerPlayback: false, currentPlayback: null })
  })
})
