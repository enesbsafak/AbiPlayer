import { describe, expect, it } from 'vitest'
import { parseM3U } from './m3u-parser'

describe('parseM3U', () => {
  it('parses EXTINF metadata into channels and categories', () => {
    const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="kanal.tr" tvg-name="Kanal TR" tvg-logo="https://img/logo.png" group-title="Ulusal",Kanal TR HD
https://cdn.example.com/live/kanal.m3u8
#EXTINF:-1 group-title="Filmler",Aksiyon Gecesi
https://cdn.example.com/media/movie.mp4`

    const { channels, categories } = parseM3U(playlist, 'source_1')

    expect(categories).toEqual([
      { id: 'source_1_m3u_0', name: 'Ulusal', sourceId: 'source_1', type: 'live' },
      { id: 'source_1_m3u_1', name: 'Filmler', sourceId: 'source_1', type: 'live' }
    ])

    expect(channels).toEqual([
      {
        id: 'source_1_m3u_ch_0',
        name: 'Kanal TR HD',
        logo: 'https://img/logo.png',
        streamUrl: 'https://cdn.example.com/live/kanal.m3u8',
        sourceId: 'source_1',
        categoryId: 'source_1_m3u_0',
        categoryName: 'Ulusal',
        epgChannelId: 'kanal.tr',
        group: 'Ulusal',
        type: 'live'
      },
      {
        id: 'source_1_m3u_ch_1',
        name: 'Aksiyon Gecesi',
        streamUrl: 'https://cdn.example.com/media/movie.mp4',
        sourceId: 'source_1',
        categoryId: 'source_1_m3u_1',
        categoryName: 'Filmler',
        epgChannelId: undefined,
        group: 'Filmler',
        logo: undefined,
        type: 'vod'
      }
    ])
  })

  it('creates a minimal channel entry for bare URLs', () => {
    const { channels, categories } = parseM3U('https://cdn.example.com/simple/live.m3u8', 'source_2')

    expect(categories).toEqual([])
    expect(channels).toEqual([
      {
        id: 'source_2_m3u_ch_0',
        name: 'live.m3u8',
        streamUrl: 'https://cdn.example.com/simple/live.m3u8',
        sourceId: 'source_2',
        categoryId: undefined,
        categoryName: undefined,
        epgChannelId: undefined,
        group: undefined,
        logo: undefined,
        type: 'live'
      }
    ])
  })
})
