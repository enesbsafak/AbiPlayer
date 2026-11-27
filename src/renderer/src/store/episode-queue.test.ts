import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { adjacentEpisodes, createPlayerSlice, isEpisodePlayback, type PlayerSlice } from './player-slice'
import type { PlaybackSourceState } from '@/services/playback'
import { findM3uEntry } from '@/services/playback'
import type { EpisodePlaybackRequest, SubtitleTrack } from '@/types/player'
import type { Channel } from '@/types/playlist'
import { episodeQueueOf, queuedEpisodeOf } from '@/services/xtream-series'
import { m3uSeriesDetail, m3uSeriesQueue, parseEpisodeName } from '@/services/m3u-series'
import { parseM3U } from '@/services/m3u-parser'
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

const requests = [episode(101, 1, 1), episode(102, 1, 2), episode(201, 2, 1)]
const queue = requests.map(queuedEpisodeOf)
const film: Channel = { id: 'vod-1', name: 'Film', streamUrl: 'https://example.com/movie/u/p/1.mp4', sourceId: 'src', type: 'vod', streamId: 1 }

const subtitles: SubtitleTrack[] = [
  { id: 'mpv-s:1', name: 'English', lang: 'eng', type: 'embedded' },
  { id: 'mpv-s:2', name: 'Türkçe', lang: 'tur', type: 'embedded' }
]

const playingKey = (store: ReturnType<typeof createStore>) => store.getState().currentPlayback!.mediaKey

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
    expect(list.map((entry) => entry.mediaKey)).toEqual(['episode:src:101', 'episode:src:102', 'episode:src:201'])
  })

  it('knows the neighbours of the episode being played, across the season boundary', () => {
    const store = createStore()
    store.getState().playEpisode(requests[1]!, queue)
    const { previous, next } = adjacentEpisodes(store.getState().episodeQueue, playingKey(store))
    expect(previous?.mediaKey).toBe('episode:src:101')
    expect(next?.mediaKey).toBe('episode:src:201')
  })

  it('keeps the queue for the next episode and drops it for anything else', () => {
    const store = createStore()
    store.getState().playEpisode(requests[0]!, queue)
    store.getState().playQueued(queue[1]!)
    expect(store.getState().episodeQueue).toBe(queue)
    expect(adjacentEpisodes(store.getState().episodeQueue, playingKey(store)).next?.mediaKey).toBe('episode:src:201')

    store.getState().playChannel(film)
    expect(store.getState().episodeQueue).toBeNull()
  })

  it('takes a queue loaded later only when what plays is one of its entries', () => {
    const store = createStore()
    store.getState().playEpisode(requests[0]!)
    expect(store.getState().episodeQueue).toBeNull()
    store.getState().setEpisodeQueue([queuedEpisodeOf(episode(900, 1, 1))])
    expect(store.getState().episodeQueue).toBeNull()
    store.getState().setEpisodeQueue(queue)
    expect(store.getState().episodeQueue).toBe(queue)
  })
})

describe('series gathered from an M3U list', () => {
  const playlist = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="http://img.example/kuzey.png" group-title="Yerli Diziler",Kuzey Yıldızı S01 E02 - İkinci',
    'http://example.com/series/u/p/12.mkv',
    '#EXTINF:-1 group-title="Yerli Diziler",Kuzey Yıldızı S01 E01',
    'http://example.com/series/u/p/11.mkv',
    '#EXTINF:-1 group-title="Yerli Diziler",Kuzey Yıldızı S02E01',
    '#EXTVLCOPT:http-user-agent=UA Bir',
    'http://example.com/series/u/p/21.mkv',
    '#EXTINF:-1 group-title="Yerli Diziler",Tek Başına Bir Kayıt',
    'http://example.com/series/u/p/90.mkv',
    '#EXTINF:-1 group-title="Yerli Diziler",Sessiz Liman 3. Bölüm',
    'http://example.com/series/u/p/33.mkv',
    // Files named like episodes make a series group, whatever it is called.
    '#EXTINF:-1 group-title="Yeni Gelenler",Gece Treni 1x02',
    'http://example.com/x/2.mp4',
    '#EXTINF:-1 group-title="Yeni Gelenler",Gece Treni 1x01',
    'http://example.com/x/1.mp4',
    '#EXTINF:-1 group-title="Ulusal",TRT 1',
    'http://example.com/live/u/p/1.ts'
  ].join('\n')
  const parsed = parseM3U(playlist, 's')
  const kuzey = parsed.channels.find((channel) => channel.name === 'Kuzey Yıldızı')!

  it('reads the series, season and episode an entry name states', () => {
    expect(parseEpisodeName('Kuzey Yıldızı S01 E02 - İkinci')).toEqual({ series: 'Kuzey Yıldızı', season: 1, episode: 2, title: 'İkinci' })
    expect(parseEpisodeName('Dizi (2021) - S1E10')).toEqual({ series: 'Dizi (2021)', season: 1, episode: 10, title: '' })
    expect(parseEpisodeName('Dizi 2. Sezon 5. Bölüm')).toEqual({ series: 'Dizi', season: 2, episode: 5, title: '' })
    expect(parseEpisodeName('Dizi Sezon 3 Bölüm 4')).toEqual({ series: 'Dizi', season: 3, episode: 4, title: '' })
    expect(parseEpisodeName('Dizi 12.Bölüm')).toEqual({ series: 'Dizi', season: 1, episode: 12, title: '' })
    expect(parseEpisodeName('Dizi | 2x07 Final')).toEqual({ series: 'Dizi', season: 2, episode: 7, title: 'Final' })
    // No episode stated, or no series name in front of it.
    expect(parseEpisodeName('Kayıp Şehir (2024)')).toBeNull()
    expect(parseEpisodeName('S01E02')).toBeNull()
    expect(parseEpisodeName('TRT 1')).toBeNull()
  })

  it('gathers the episodes into one item per series, in watching order', () => {
    expect(parsed.channels.map((channel) => [channel.name, channel.type, channel.m3uEpisodes?.length ?? null])).toEqual([
      ['Kuzey Yıldızı', 'series', 3],
      // Names no episode: stays a card of its own, playable as before.
      ['Tek Başına Bir Kayıt', 'series', null],
      ['Sessiz Liman', 'series', 1],
      ['Gece Treni', 'series', 2],
      ['TRT 1', 'live', null]
    ])
    expect(kuzey.streamUrl).toBe('')
    expect(kuzey.logo).toBe('http://img.example/kuzey.png')
    expect(kuzey.m3uEpisodes!.map((entry) => [entry.season, entry.episode, entry.title])).toEqual([[1, 1, ''], [1, 2, 'İkinci'], [2, 1, '']])
    expect(kuzey.m3uEpisodes![2]!.httpHeaders).toEqual({ userAgent: 'UA Bir' })
    // The same list gives the same series id (favourites, the page to return to).
    expect(parseM3U(playlist, 's').channels[0]!.id).toBe(kuzey.id)

    const detail = m3uSeriesDetail(kuzey)
    expect(detail.seasons.map((season) => [season.seasonNumber, season.episodeCount])).toEqual([[1, 2], [2, 1]])
  })

  it('plays its episodes as a queue, with the subtitle memory of the series', () => {
    const store = createStore()
    const episodes = m3uSeriesQueue(kuzey)
    store.getState().playQueued(episodes[0]!, episodes)
    expect(isEpisodePlayback(store.getState().currentPlayback, store.getState().currentChannel)).toBe(true)
    expect(adjacentEpisodes(store.getState().episodeQueue, playingKey(store)).next?.title).toContain('S1E2')

    store.getState().applyPlayerPatch({ subtitleTracks: subtitles })
    store.getState().selectSubtitleTrack('mpv-s:2')
    store.getState().playQueued(episodes[2]!)
    expect(store.getState().episodeQueue).toBe(episodes)
    expect(store.getState().rememberedTracks?.subtitle).toEqual({ name: 'Türkçe', lang: 'tur' })
    // Its request headers go along with it.
    expect(store.getState().currentPlayback?.httpHeaders).toEqual({ userAgent: 'UA Bir' })
  })

  it('finds an episode from the history, which only knows the hash of its address', () => {
    const lookup = {
      getItem: (id: string) => parsed.channels.find((channel) => channel.id === id),
      getItems: (_sourceId: string, type: Channel['type']) => parsed.channels.filter((channel) => channel.type === type)
    }
    const target = m3uSeriesQueue(kuzey)[1]!.request.target
    if (target.kind !== 'm3u') throw new Error('an M3U target was expected')
    const found = findM3uEntry(target, lookup, 'an-id-from-before-the-grouping')
    expect(found?.streamUrl).toBe('http://example.com/series/u/p/12.mkv')
    expect(found?.seriesRef).toBe(kuzey.id)
  })
})

describe('remembered tracks', () => {
  it("opens the next episode with the viewer's subtitle language, not its track number", () => {
    const store = createStore()
    store.getState().playEpisode(requests[0]!, queue)
    store.getState().applyPlayerPatch({ subtitleTracks: subtitles })
    store.getState().selectSubtitleTrack('mpv-s:2')

    store.getState().playQueued(queue[1]!)
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
    store.getState().playEpisode(requests[0]!, queue)
    store.getState().selectSubtitleTrack(null)
    store.getState().playQueued(queue[1]!)

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
    store.getState().playEpisode(requests[0]!, queue)
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
