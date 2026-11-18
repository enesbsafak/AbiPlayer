import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { adjacentEpisodes, createPlayerSlice, type PlayerSlice } from './player-slice'
import type { PlaybackSourceState } from '@/services/playback'
import type { EpisodePlaybackRequest, SubtitleTrack } from '@/types/player'
import type { Channel } from '@/types/playlist'
import { episodeQueueOf } from '@/services/xtream-series'
import { matchRememberedTrack, sanitizeTrackMemory } from '@/services/track-memory'
import { FRESH_TRACK_PREFERENCES, reconcileSubtitleSelection } from '@/player/track-reconciler'

function createStore() {
  return create<PlayerSlice & PlaybackSourceState>()((...args) => ({
    ...createPlayerSlice(...args),
    getXtreamCredentials: () => ({ url: 'https://example.com', username: 'u', password: 'p' })
  }))
}

function episode(episodeId: number, season: number, episodeNum: number): EpisodePlaybackRequest {
  return {
    sourceId: 'src',
    seriesId: 7,
    season,
    episodeNum,
    episodeId,
    containerExtension: 'mkv',
    title: `Dizi S${season} B${episodeNum}`
  }
}

const queue = [episode(101, 1, 1), episode(102, 1, 2), episode(201, 2, 1)]
const film: Channel = { id: 'vod-1', name: 'Film', streamUrl: 'https://example.com/movie/u/p/1.mp4', sourceId: 'src', type: 'vod', streamId: 1 }

const subtitles: SubtitleTrack[] = [
  { id: 'mpv-s:1', name: 'English', lang: 'eng', type: 'embedded' },
  { id: 'mpv-s:2', name: 'Türkçe', lang: 'tur', type: 'embedded' }
]

describe('episode queue', () => {
  it('lists the episodes season by season, as the series page shows them', () => {
    const base = { id: '', title: '', containerExtension: 'mkv', plot: '', duration: '', durationSecs: 0, rating: 0, coverUrl: '', streamUrl: '' }
    const list = episodeQueueOf('src', {
      seriesId: 7, name: 'Dizi', cover: '', plot: '', cast: '', director: '', genre: '', releaseDate: '', rating: '', backdropPath: [],
      seasons: [
        { seasonNumber: 1, name: '', episodeCount: 2, cover: '' },
        { seasonNumber: 2, name: '', episodeCount: 1, cover: '' }
      ],
      episodes: {
        2: [{ ...base, id: '201', season: 2, episodeNum: 1 }],
        1: [{ ...base, id: '101', season: 1, episodeNum: 1 }, { ...base, id: 'x', season: 1, episodeNum: 2 }, { ...base, id: '102', season: 1, episodeNum: 3 }]
      }
    })
    expect(list.map((entry) => entry.episodeId)).toEqual([101, 102, 201])
  })

  it('knows the neighbours of the episode being played, across the season boundary', () => {
    const store = createStore()
    store.getState().playEpisode(queue[1]!, queue)
    const target = store.getState().currentPlayback!.target
    const { previous, next } = adjacentEpisodes(store.getState().episodeQueue, target)
    expect(previous?.episodeId).toBe(101)
    expect(next?.episodeId).toBe(201)
  })

  it('keeps the queue for the next episode and drops it for anything else', () => {
    const store = createStore()
    store.getState().playEpisode(queue[0]!, queue)
    store.getState().playEpisode(queue[1]!)
    expect(store.getState().episodeQueue).toBe(queue)
    expect(adjacentEpisodes(store.getState().episodeQueue, store.getState().currentPlayback!.target).next?.episodeId).toBe(201)

    store.getState().playChannel(film)
    expect(store.getState().episodeQueue).toBeNull()
  })

  it('takes a queue loaded later only for the series being played', () => {
    const store = createStore()
    store.getState().playEpisode(queue[0]!)
    expect(store.getState().episodeQueue).toBeNull()
    store.getState().setEpisodeQueue('src', 8, queue)
    expect(store.getState().episodeQueue).toBeNull()
    store.getState().setEpisodeQueue('src', 7, queue)
    expect(store.getState().episodeQueue).toBe(queue)
  })
})

describe('remembered tracks', () => {
  it("opens the next episode with the viewer's subtitle language, not its track number", () => {
    const store = createStore()
    store.getState().playEpisode(queue[0]!, queue)
    store.getState().applyPlayerPatch({ subtitleTracks: subtitles })
    store.getState().selectSubtitleTrack('mpv-s:2')

    store.getState().playEpisode(queue[1]!)
    const state = store.getState()
    expect(state.currentSubtitleTrack).toBeNull()
    expect(state.rememberedTracks?.subtitle).toEqual({ name: 'Türkçe', lang: 'tur' })

    // The next episode lists its tracks the other way round.
    const reordered: SubtitleTrack[] = [
      { id: 'mpv-s:1', name: 'Turkish', lang: 'tr', type: 'embedded' },
      { id: 'mpv-s:2', name: 'English', lang: 'en', type: 'embedded' }
    ]
    const settings = { preferredAudioLanguage: 'auto', preferredSubtitleLanguage: 'auto', defaultSubtitleEnabled: false }
    const result = reconcileSubtitleSelection(reordered, null, { ...state, settings }, FRESH_TRACK_PREFERENCES)
    expect(result.track).toBe('mpv-s:1')
  })

  it('remembers "off" for the series and turns off what the engine shows by itself', () => {
    const store = createStore()
    store.getState().playEpisode(queue[0]!, queue)
    store.getState().selectSubtitleTrack(null)
    store.getState().playEpisode(queue[1]!)

    const settings = { preferredAudioLanguage: 'auto', preferredSubtitleLanguage: 'tr', defaultSubtitleEnabled: true }
    const context = { ...store.getState(), settings }
    const first = reconcileSubtitleSelection(subtitles, null, context, FRESH_TRACK_PREFERENCES)
    expect(first.track).toBeUndefined()
    expect(first.state.subtitlesOffByDefault).toBe(true)
    // mpv reports its own selection only after the track list.
    const later = reconcileSubtitleSelection(subtitles, 'mpv-s:1', context, first.state)
    expect(later.track).toBeUndefined()
    expect(later.disableEngineSubtitles).toBe(true)
  })

  it('does not remember a subtitle file, and keeps a film apart from a series', () => {
    const store = createStore()
    store.getState().playChannel(film)
    store.getState().applyPlayerPatch({ subtitleTracks: [{ id: 'mpv-s:3', name: 'dosya.srt', type: 'external' }] })
    store.getState().selectSubtitleTrack('mpv-s:3')
    expect(store.getState().trackMemory).toEqual([])

    store.getState().applyPlayerPatch({ subtitleTracks: subtitles })
    store.getState().selectSubtitleTrack('mpv-s:1')
    store.getState().playEpisode(queue[0]!, queue)
    expect(store.getState().rememberedTracks).toBeNull()
  })

  it('matches by language, then by name; a track without a language only by its name', () => {
    const tracks = [
      { id: 'a', name: 'Türkçe', lang: 'tur' },
      { id: 'b', name: 'Türkçe (Zorunlu)', lang: 'tr' },
      { id: 'c', name: 'Altyazı 3' }
    ]
    expect(matchRememberedTrack(tracks, { name: 'Türkçe (Zorunlu)', lang: 'tur' })).toBe('b')
    expect(matchRememberedTrack(tracks, { name: 'Başka', lang: 'tr' })).toBe('a')
    expect(matchRememberedTrack(tracks, { name: 'Altyazı 3' })).toBe('c')
    expect(matchRememberedTrack(tracks, { name: 'English', lang: 'en' })).toBeNull()
  })

  it('drops unreadable stored entries', () => {
    const stored = [
      { key: 'series:src:7', subtitle: { name: 'Türkçe', lang: 'tur' }, updatedAt: 5 },
      { key: 'series:src:7', subtitle: 'off', updatedAt: 6 },
      { key: 'movie:src:1', subtitle: 'off', audio: { name: 42 }, updatedAt: 'x' },
      { key: 'movie:src:2', subtitle: { lang: 'tr' } },
      'nonsense'
    ]
    expect(sanitizeTrackMemory(stored)).toEqual([
      { key: 'series:src:7', subtitle: { name: 'Türkçe', lang: 'tur' }, updatedAt: 5 },
      { key: 'movie:src:1', subtitle: 'off', updatedAt: 0 }
    ])
    expect(sanitizeTrackMemory({})).toEqual([])
  })
})
