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

    expect(categories).toHaveLength(2)
    expect(categories[0]).toMatchObject({ name: 'Ulusal', sourceId: 'source_1', type: 'live' })
    expect(categories[1]).toMatchObject({ name: 'Filmler', sourceId: 'source_1', type: 'vod' })
    // IDs should be stable hash-based
    expect(categories[0].id).toMatch(/^source_1_m3u_[0-9a-f]{8}$/)
    expect(categories[1].id).toMatch(/^source_1_m3u_[0-9a-f]{8}$/)

    expect(channels).toEqual([
      {
        id: 'source_1_m3u_ch_0',
        name: 'Kanal TR HD',
        logo: 'https://img/logo.png',
        streamUrl: 'https://cdn.example.com/live/kanal.m3u8',
        sourceId: 'source_1',
        categoryId: categories[0].id,
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
        categoryId: categories[1].id,
        categoryName: 'Filmler',
        epgChannelId: undefined,
        group: 'Filmler',
        logo: undefined,
        type: 'vod'
      }
    ])
  })

  it('creates a minimal channel entry for bare URLs with clean name', () => {
    const { channels, categories } = parseM3U('https://cdn.example.com/simple/live.m3u8', 'source_2')

    expect(categories).toEqual([])
    expect(channels).toEqual([
      {
        id: 'source_2_m3u_ch_0',
        name: 'live',
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

  it('parses unquoted attributes', () => {
    const playlist = `#EXTINF:-1 tvg-id=kanal.tr tvg-logo=https://img.png group-title=Spor,Test Kanal
https://stream.example.com/live.m3u8`

    const { channels } = parseM3U(playlist, 'src')
    expect(channels[0].epgChannelId).toBe('kanal.tr')
    expect(channels[0].logo).toBe('https://img.png')
    expect(channels[0].group).toBe('Spor')
  })

  it('handles #EXTGRP tag for group assignment', () => {
    const playlist = `#EXTM3U
#EXTINF:-1,Kanal 1
#EXTGRP:Ulusal
https://stream.example.com/1.m3u8`

    const { channels, categories } = parseM3U(playlist, 'src')
    expect(channels[0].group).toBe('Ulusal')
    expect(categories).toHaveLength(1)
    expect(categories[0].name).toBe('Ulusal')
  })

  it('stable category IDs across same content', () => {
    const playlist = `#EXTINF:-1 group-title="Spor",Kanal 1
https://a.com/1.m3u8`

    const result1 = parseM3U(playlist, 'src')
    const result2 = parseM3U(playlist, 'src')
    expect(result1.categories[0].id).toBe(result2.categories[0].id)
  })
})
