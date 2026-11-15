import { defined } from '../../../shared/checked'
import { describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { createPlayerSlice, type PlayerSlice } from './player-slice'
import type { Channel } from '@/types/playlist'
import type { XtreamCredentials } from '@/types/xtream'
import type { PlaybackSourceState } from '@/services/playback'

function createPlayerTestStore() {
  return create<PlayerSlice>()((...args) => createPlayerSlice(...args))
}

function createStoreWithCredentials(credentials: Record<string, XtreamCredentials>) {
  return create<PlayerSlice & PlaybackSourceState>()((...args) => ({
    ...createPlayerSlice(...args),
    getXtreamCredentials: (sourceId: string) => credentials[sourceId] ?? null
  }))
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
  it('starts a new playback of the same media and clears the error without touching the channel or selections', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().selectSubtitleTrack('mpv-s:2')
    store.getState().applyPlayerPatch({
      playerError: 'Bağlantı kesildi',
      currentTime: 1200,
      duration: 5400,
      currentAudioTrack: 'mpv-a:1'
    })
    store.getState().completeResume(defined(store.getState().pendingResume, 'the armed resume').playbackId)
    const channelBefore = store.getState().currentChannel
    const before = defined(store.getState().currentPlayback, 'the playback before the reload')

    store.getState().reloadPlayback()

    const state = store.getState()
    expect(state.currentPlayback?.playbackId).not.toBe(before.playbackId)
    expect(state.currentPlayback?.mediaKey).toBe(before.mediaKey)
    expect(state.playerError).toBeNull()
    expect(state.currentChannel).toBe(channelBefore)
    expect(state.currentAudioTrack).toBe('mpv-a:1')
    expect(state.currentSubtitleTrack).toBe('mpv-s:2')
    // The reload starts the film again, so it has to be put back where it was.
    expect(state.pendingResume?.playbackId).toBe(state.currentPlayback?.playbackId)
    expect(state.duration).toBe(0)
  })

  it('is a new playback of the same item', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().markPlaybackLoaded(store.getState().currentPlayback!.playbackId)
    const before = store.getState().currentPlayback!

    store.getState().reloadPlayback()

    const after = store.getState().currentPlayback!
    expect(after.playbackId).not.toBe(before.playbackId)
    expect(after.mediaKey).toBe(before.mediaKey)
    expect(after.streamUrl).toBe(before.streamUrl)
    // The old load no longer counts as loaded.
    expect(store.getState().loadedPlaybackId).toBeNull()
  })

  it('does not arm a resume for live channels', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(live)
    const before = defined(store.getState().currentPlayback, 'the live playback')
    store.getState().reloadPlayback()
    expect(store.getState().currentPlayback?.playbackId).not.toBe(before.playbackId)
    expect(store.getState().currentPlayback?.mediaKey).toBe(before.mediaKey)
    expect(store.getState().pendingResume).toBeNull()
  })

  it('is a no-op with nothing selected', () => {
    const store = createPlayerTestStore()
    const before = store.getState()
    store.getState().reloadPlayback()
    expect(store.getState()).toBe(before)
    expect(store.getState().currentPlayback).toBeNull()
  })
})

describe('player-slice suspendPlayback', () => {
  it('reports the item as paused, not playing, and arms the resume for a film', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().completeResume(defined(store.getState().pendingResume, 'the armed resume').playbackId)
    store.getState().applyPlayerPatch({ isPlaying: true, isPaused: false, currentTime: 1800, duration: 5400 })

    store.getState().suspendPlayback()

    const state = store.getState()
    expect(state.currentChannel?.id).toBe(movie.id)
    expect(state.isPlaybackSuspended).toBe(true)
    expect(state.isPlaying).toBe(false)
    expect(state.isPaused).toBe(true)
    expect(state.currentTime).toBe(0)
    expect(state.duration).toBe(0)
    expect(state.pendingResume?.mediaKey).toBe(state.currentPlayback?.mediaKey)
    expect(state.pendingResume?.phase).toBe('awaiting-load')
  })

  it('comes back as a new playback, and the resume moves over to it', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    const first = store.getState().currentPlayback!.playbackId
    store.getState().suspendPlayback()

    store.getState().resumeSuspendedPlayback()

    const { currentPlayback, pendingResume } = store.getState()
    expect(currentPlayback!.playbackId).not.toBe(first)
    expect(pendingResume?.playbackId).toBe(currentPlayback!.playbackId)
  })

  it('lets a live channel simply restart', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(live)
    store.getState().suspendPlayback()
    expect(store.getState().isPlaybackSuspended).toBe(true)
    expect(store.getState().pendingResume).toBeNull()
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

// P6: the return from the mini card is a new load of the same item, like a
// reload; the viewer's choices survive both the same way.
describe('player-slice viewer choices across suspend and resume', () => {
  it('keeps the audio and subtitle choice, including "off"', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().applyPlayerPatch({ currentAudioTrack: 'mpv-a:2', audioTracks: [{ id: 'mpv-a:2', name: 'TR' }] })
    store.getState().selectSubtitleTrack(null)

    store.getState().suspendPlayback()
    store.getState().resumeSuspendedPlayback()

    const state = store.getState()
    expect(state.currentAudioTrack).toBe('mpv-a:2')
    expect(state.currentSubtitleTrack).toBeNull()
    expect(state.isSubtitleTrackUserChoice).toBe(true)
    // The track lists belong to the load and come back with the new one.
    expect(state.audioTracks).toEqual([])
  })

  it('keeps a subtitle file the viewer loaded, on either engine', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    const cues = [{ startTime: 1, endTime: 2, text: 'Merhaba' }]
    store.getState().applyPlayerPatch({ subtitleCues: cues })
    store.getState().selectSubtitleTrack('external')
    store.getState().suspendPlayback()
    expect(store.getState().currentSubtitleTrack).toBe('external')
    expect(store.getState().subtitleCues).toEqual(cues)

    const mediaKey = store.getState().currentPlayback!.mediaKey
    const file = { mediaKey, path: 'C:/a.srt', trackId: 'mpv-s:3' }
    store.getState().resumeSuspendedPlayback()
    store.getState().applyPlayerPatch({ externalSubtitle: file })
    store.getState().selectSubtitleTrack('mpv-s:3')
    store.getState().suspendPlayback()
    store.getState().resumeSuspendedPlayback()
    expect(store.getState().externalSubtitle).toEqual(file)
    expect(store.getState().currentSubtitleTrack).toBe('mpv-s:3')
  })

  it('drops the choices when something else is played', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    store.getState().applyPlayerPatch({
      currentAudioTrack: 'mpv-a:2',
      externalSubtitle: { mediaKey: store.getState().currentPlayback!.mediaKey, path: 'C:/a.srt', trackId: 'mpv-s:3' }
    })
    store.getState().selectSubtitleTrack('mpv-s:3')
    store.getState().suspendPlayback()
    store.getState().playChannel(live)

    const state = store.getState()
    expect(state.currentAudioTrack).toBeNull()
    expect(state.currentSubtitleTrack).toBeNull()
    expect(state.isSubtitleTrackUserChoice).toBe(false)
    expect(state.externalSubtitle).toBeNull()
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
    expect(store.getState().activeSubtitleCues[0]?.text).toBe('İki')
  })
})

describe('player-slice playback identity', () => {
  const credentials: XtreamCredentials = { url: 'http://panel.example', username: 'u', password: 'p#1' }
  const xtreamFilm: Channel = {
    id: 'acc-a_vod_7',
    name: 'Film',
    streamUrl: 'http://panel.example/movie/old/stale/7.mp4',
    streamId: 7,
    containerExtension: 'mkv',
    sourceId: 'acc-a',
    type: 'vod'
  }

  it('issues a new playback id for every start, even of the same item', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    const first = store.getState().currentPlayback!
    store.getState().playChannel(movie)
    const second = store.getState().currentPlayback!
    expect(second.playbackId).not.toBe(first.playbackId)
    expect(second.mediaKey).toBe(first.mediaKey)
  })

  it('builds an Xtream URL from the source credentials instead of the stored one', () => {
    const store = createStoreWithCredentials({ 'acc-a': credentials })
    store.getState().playChannel(xtreamFilm)
    const playback = store.getState().currentPlayback!
    expect(playback.target).toEqual({ kind: 'movie', sourceId: 'acc-a', streamId: 7, containerExtension: 'mkv' })
    expect(playback.mediaKey).toBe('movie:acc-a:7')
    expect(playback.streamUrl).toBe('http://panel.example/movie/u/p%231/7.mkv')
  })

  it('keeps two accounts on one host apart', () => {
    const store = createStoreWithCredentials({ 'acc-a': credentials, 'acc-b': credentials })
    store.getState().playChannel(xtreamFilm)
    const a = store.getState().currentPlayback!.mediaKey
    store.getState().playChannel({ ...xtreamFilm, sourceId: 'acc-b' })
    expect(store.getState().currentPlayback!.mediaKey).not.toBe(a)
  })

  it('falls back to the stored URL while the credentials are not known', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(xtreamFilm)
    expect(store.getState().currentPlayback!.streamUrl).toBe(xtreamFilm.streamUrl)
  })

  it('refuses an item it cannot derive a stream for', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel({ ...xtreamFilm, streamUrl: '' })
    expect(store.getState().currentPlayback).toBeNull()
    expect(store.getState().currentChannel).toBeNull()
    expect(store.getState().playerError).not.toBeNull()
  })

  it('plays an episode with a real episode target and a stable display id', () => {
    const store = createStoreWithCredentials({ 'acc-a': credentials })
    const request = {
      sourceId: 'acc-a',
      seriesId: 40,
      season: 2,
      episodeNum: 3,
      episodeId: 901,
      containerExtension: 'mp4',
      title: 'Dizi - S2E3 - Bölüm'
    }
    store.getState().playEpisode(request)
    const first = store.getState()
    expect(first.currentPlayback!.target).toEqual({
      kind: 'episode',
      sourceId: 'acc-a',
      streamId: 901,
      containerExtension: 'mp4',
      seriesId: 40,
      season: 2,
      episode: 3
    })
    expect(first.currentPlayback!.mediaKey).toBe('episode:acc-a:901')
    expect(first.currentPlayback!.streamUrl).toBe('http://panel.example/series/u/p%231/901.mp4')
    expect(first.pendingResume).not.toBeNull()

    store.getState().playEpisode(request)
    expect(store.getState().currentChannel!.id).toBe(first.currentChannel!.id)
  })

  it('only accepts a load report and a resume step for the current playback', () => {
    const store = createPlayerTestStore()
    store.getState().playChannel(movie)
    const stale = store.getState().currentPlayback!.playbackId
    store.getState().reloadPlayback()
    const current = store.getState().currentPlayback!.playbackId

    store.getState().markPlaybackLoaded(stale)
    expect(store.getState().loadedPlaybackId).toBeNull()
    store.getState().completeResume(stale)
    expect(store.getState().pendingResume).not.toBeNull()

    store.getState().markPlaybackLoaded(current)
    expect(store.getState().loadedPlaybackId).toBe(current)
    store.getState().markResumeSeekIssued(current, 120)
    expect(store.getState().pendingResume).toMatchObject({ phase: 'seek-issued', position: 120 })
    store.getState().completeResume(current)
    expect(store.getState().pendingResume).toBeNull()
  })
})
