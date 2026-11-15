import { describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import type { Channel } from '@/types/playlist'

function createPlayerTestStore() {
  return create<PlayerSlice>()((...args) => createPlayerSlice(...args))
}

const movie: Channel = {
  id: 'vod-1',
  name: 'Film',
  streamUrl: 'https://example.com/movie/u/p/1.mp4',
  sourceId: 'src',
  type: 'vod'
}

const live: Channel = {
  id: 'live-1',
  name: 'Kanal',
  streamUrl: 'https://example.com/live/u/p/1.ts',
  sourceId: 'src',
  type: 'live'
}

describe('player-slice reloadPlayback', () => {
  it('bumps the reload token and clears the error without touching the channel or selections', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().selectSubtitleTrack('mpv-s:2')
    store.getState().applyPlayerPatch({
      playerError: 'Bağlantı kesildi',
      currentTime: 1200,
      duration: 5400,
      currentAudioTrack: 'mpv-a:1'
    })
    store.getState().clearPendingResume()
    const channelBefore = store.getState().currentChannel

    store.getState().reloadPlayback()

    const state = store.getState()
    expect(state.playbackReloadToken).toBe(1)
    expect(state.playerError).toBeNull()
    expect(state.currentChannel).toBe(channelBefore)
    expect(state.currentAudioTrack).toBe('mpv-a:1')
    expect(state.currentSubtitleTrack).toBe('mpv-s:2')
    // The reload starts the film again, so it has to be put back where it was.
    expect(state.pendingResumeStreamUrl).toBe(movie.streamUrl)
    expect(state.duration).toBe(0)
  })

  it('does not arm a resume for live channels', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(live)
    store.getState().reloadPlayback()
    expect(store.getState().playbackReloadToken).toBe(1)
    expect(store.getState().pendingResumeStreamUrl).toBeNull()
  })

  it('is a no-op with nothing selected', () => {
    const store = createPlayerTestStore()
    store.getState().reloadPlayback()
    expect(store.getState().playbackReloadToken).toBe(0)
  })
})

describe('player-slice suspendPlayback', () => {
  it('reports the item as paused, not playing, and arms the resume for a film', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().clearPendingResume()
    store.getState().applyPlayerPatch({ isPlaying: true, isPaused: false, currentTime: 1800, duration: 5400 })

    store.getState().suspendPlayback()

    const state = store.getState()
    expect(state.currentChannel?.id).toBe(movie.id)
    expect(state.isPlaybackSuspended).toBe(true)
    expect(state.isPlaying).toBe(false)
    expect(state.isPaused).toBe(true)
    expect(state.currentTime).toBe(0)
    expect(state.duration).toBe(0)
    expect(state.pendingResumeStreamUrl).toBe(movie.streamUrl)
  })

  it('lets a live channel simply restart', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(live)
    store.getState().suspendPlayback()
    expect(store.getState().isPlaybackSuspended).toBe(true)
    expect(store.getState().pendingResumeStreamUrl).toBeNull()
  })

  it('is cleared by resuming, playing something new or stopping', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().suspendPlayback()
    store.getState().resumeSuspendedPlayback()
    expect(store.getState().isPlaybackSuspended).toBe(false)

    store.getState().suspendPlayback()
    store.getState().playChannel(live)
    expect(store.getState().isPlaybackSuspended).toBe(false)

    store.getState().suspendPlayback()
    store.getState().stopPlayback()
    expect(store.getState().isPlaybackSuspended).toBe(false)
  })

  it('does nothing without a channel', () => {
    const store = createPlayerTestStore()
    store.getState().suspendPlayback()
    expect(store.getState().isPlaybackSuspended).toBe(false)
  })
})

describe('player-slice subtitle choice', () => {
  it('marks a viewer choice, including "off", and forgets it on the next channel', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().selectSubtitleTrack(null)
    expect(store.getState().isSubtitleTrackUserChoice).toBe(true)
    expect(store.getState().currentSubtitleTrack).toBeNull()

    store.getState().playChannel(live)
    expect(store.getState().isSubtitleTrackUserChoice).toBe(false)
  })

  it('does not count engine writes as a viewer choice', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().applyPlayerPatch({ currentSubtitleTrack: 'mpv-s:1' })
    expect(store.getState().isSubtitleTrackUserChoice).toBe(false)
  })
})

describe('player-slice setActiveSubtitleCues', () => {
  it('does not notify subscribers when the active cues did not change', () => {
    const store = createPlayerTestStore()
    store.getState().setActiveSubtitleCues([{ startTime: 1, endTime: 2, text: 'Merhaba' }])
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.getState().setActiveSubtitleCues([{ startTime: 1, endTime: 2, text: 'Merhaba' }])
    store.getState().setActiveSubtitleCues([...store.getState().activeSubtitleCues])
    expect(listener).not.toHaveBeenCalled()

    store.getState().setActiveSubtitleCues([])
    store.getState().setActiveSubtitleCues([])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('publishes a real change', () => {
    const store = createPlayerTestStore()
    store.getState().setActiveSubtitleCues([{ startTime: 1, endTime: 2, text: 'Bir' }])
    store.getState().setActiveSubtitleCues([{ startTime: 2, endTime: 3, text: 'İki' }])
    expect(store.getState().activeSubtitleCues[0].text).toBe('İki')
  })
})
