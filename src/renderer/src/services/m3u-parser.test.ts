import { itemAt } from '../../../shared/checked'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createM3uParser, fetchM3uStreamed, parseExtInf, parseHeaderEpgUrls, parseM3U } from './m3u-parser'

describe('M3U header guide URL and streamed parsing (C2c)', () => {
  it('reads url-tvg and x-tvg-url, several URLs included, http(s) only', () => {
    expect(parseHeaderEpgUrls('#EXTM3U url-tvg="http://a.test/1.xml,http://b.test/2.xml" x-tvg-url="https://c.test/3.xml"')).toEqual([
      'http://a.test/1.xml',
      'http://b.test/2.xml',
      'https://c.test/3.xml'
    ])
    expect(parseHeaderEpgUrls('#EXTM3U x-tvg-url=file:///etc/passwd')).toEqual([])
    const { epgUrls } = parseM3U('#EXTM3U x-tvg-url="http://epg.test/xmltv.php?username=a&password=b"\n#EXTINF:-1,K\nhttp://c/1.ts', 's')
    expect(epgUrls).toEqual(['http://epg.test/xmltv.php?username=a&password=b'])
  })

  it('gives the same result however the text is split', () => {
    const playlist = [
      '﻿#EXTM3U url-tvg="http://epg.test/g.xml"',
      '#EXTINF:-1 tvg-id="k1" group-title="Haber",Kanal, Bir',
      'http://cdn.test/live/1.ts',
      '#EXTGRP:Filmler',
      '#EXTINF:-1,Film',
      'http://cdn.test/movie/2.mp4',
      'http://cdn.test/bare.ts'
    ].join('\r\n')
    const whole = parseM3U(playlist, 'src')
    for (const size of [1, 3, 17]) {
      const parser = createM3uParser('src')
      for (let i = 0; i < playlist.length; i += size) parser.feed(playlist.slice(i, i + size))
      expect(parser.end()).toEqual(whole)
    }
    expect(whole.channels.map((channel) => channel.name)).toEqual(['Kanal, Bir', 'Film', 'bare'])
  })
})

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
    expect(categories[0]?.id).toMatch(/^source_1_m3u_[0-9a-f]{8}$/)
    expect(categories[1]?.id).toMatch(/^source_1_m3u_[0-9a-f]{8}$/)

    expect(channels).toEqual([
      {
        id: 'source_1_m3u_ch_cc2d3055',
        name: 'Kanal TR HD',
        logo: 'https://img/logo.png',
        streamUrl: 'https://cdn.example.com/live/kanal.m3u8',
        sourceId: 'source_1',
        categoryId: categories[0]?.id,
        categoryName: 'Ulusal',
        epgChannelId: 'kanal.tr',
        group: 'Ulusal',
        type: 'live',
        isAdult: false
      },
      {
        id: 'source_1_m3u_ch_7b5bf0c6',
        name: 'Aksiyon Gecesi',
        streamUrl: 'https://cdn.example.com/media/movie.mp4',
        sourceId: 'source_1',
        categoryId: categories[1]?.id,
        categoryName: 'Filmler',
        epgChannelId: undefined,
        group: 'Filmler',
        logo: undefined,
        type: 'vod',
        isAdult: false
      }
    ])
  })

  it('creates a minimal channel entry for bare URLs with clean name', () => {
    const { channels, categories } = parseM3U('https://cdn.example.com/simple/live.m3u8', 'source_2')

    expect(categories).toEqual([])
    expect(channels).toEqual([
      {
        id: 'source_2_m3u_ch_56e643b0',
        name: 'live',
        streamUrl: 'https://cdn.example.com/simple/live.m3u8',
        sourceId: 'source_2',
        categoryId: undefined,
        categoryName: undefined,
        epgChannelId: undefined,
        group: undefined,
        logo: undefined,
        type: 'live',
        isAdult: false
      }
    ])
  })

  it('parses unquoted attributes', () => {
    const playlist = `#EXTINF:-1 tvg-id=kanal.tr tvg-logo=https://img.png group-title=Spor,Test Kanal
https://stream.example.com/live.m3u8`

    const { channels } = parseM3U(playlist, 'src')
    expect(channels[0]?.epgChannelId).toBe('kanal.tr')
    expect(channels[0]?.logo).toBe('https://img.png')
    expect(channels[0]?.group).toBe('Spor')
  })

  it('handles #EXTGRP tag for group assignment', () => {
    const playlist = `#EXTM3U
#EXTINF:-1,Kanal 1
#EXTGRP:Ulusal
https://stream.example.com/1.m3u8`

    const { channels, categories } = parseM3U(playlist, 'src')
    expect(channels[0]?.group).toBe('Ulusal')
    expect(categories).toHaveLength(1)
    expect(categories[0]?.name).toBe('Ulusal')
  })

  it('flags channels in an adult group, even when the channel name is clean', () => {
    // Real M3U playlists routinely open with the adult groups, which is why
    // "Tüm Kanallar" used to lead with them.
    const playlist = `#EXTM3U
#EXTINF:-1 group-title="XXX",Kanal A
https://a.com/1.m3u8
#EXTINF:-1 group-title="Yetişkin",Kanal B
https://a.com/2.m3u8
#EXTINF:-1 group-title="Ulusal",Kanal C
https://a.com/3.m3u8`

    const { channels } = parseM3U(playlist, 'src')

    expect(channels.map((c) => [c.name, c.isAdult])).toEqual([
      ['Kanal A', true],
      ['Kanal B', true],
      ['Kanal C', false]
    ])
  })

  it('flags an adult channel name inside an ordinary group', () => {
    const playlist = `#EXTINF:-1 group-title="Ulusal",Brazzers TV
https://a.com/1.m3u8
#EXTINF:-1 group-title="Ulusal",Haber TV
https://a.com/2.m3u8`

    const { channels } = parseM3U(playlist, 'src')
    expect(channels[0]?.isAdult).toBe(true)
    expect(channels[1]?.isAdult).toBe(false)
  })

  it('stable category IDs across same content', () => {
    const playlist = `#EXTINF:-1 group-title="Spor",Kanal 1
https://a.com/1.m3u8`

    const result1 = parseM3U(playlist, 'src')
    const result2 = parseM3U(playlist, 'src')
    expect(itemAt(result1.categories, 0).id).toBe(itemAt(result2.categories, 0).id)
  })

  it('stable channel IDs across same content', () => {
    const playlist = `#EXTINF:-1 group-title="Spor",Kanal 1
https://a.com/1.m3u8`

    const result1 = parseM3U(playlist, 'src')
    const result2 = parseM3U(playlist, 'src')
    expect(itemAt(result1.channels, 0).id).toBe(itemAt(result2.channels, 0).id)
  })

  it('keeps commas in the channel name and in quoted attributes', () => {
    // The name used to be taken after the last comma, so this became " Bölüm 2".
    const playlist = `#EXTINF:-1 tvg-name="Film, Bölüm 2" group-title="Aksiyon, Macera",Film, Bölüm 2
https://a.com/movie/1.mp4`

    const [channel] = parseM3U(playlist, 'src').channels
    expect(channel?.name).toBe('Film, Bölüm 2')
    expect(channel?.group).toBe('Aksiyon, Macera')
  })

  it('does not read attributes that appear in the name', () => {
    const meta = parseExtInf('#EXTINF:-1 group-title="Haber",Kanal group-title="Sahte"')
    expect(meta.group).toBe('Haber')
    expect(meta.name).toBe('Kanal group-title="Sahte"')
  })

  it('gives a repeated URL a distinct id and keeps the first id unchanged', () => {
    const single = parseM3U(`#EXTINF:-1 group-title="Ulusal",Kanal
https://a.com/1.m3u8`, 'src')
    const repeated = parseM3U(`#EXTINF:-1 group-title="Ulusal",Kanal
https://a.com/1.m3u8
#EXTINF:-1 group-title="Spor",Kanal (Spor)
https://a.com/1.m3u8
#EXTINF:-1 group-title="Favori",Kanal (Favori)
https://a.com/1.m3u8`, 'src')

    const ids = repeated.channels.map((c) => c.id)
    expect(ids[0]).toBe(itemAt(single.channels, 0).id)
    expect(ids).toEqual([ids[0], `${ids[0]}_2`, `${ids[0]}_3`])
    expect(new Set(ids).size).toBe(3)

    // Deterministic across refreshes.
    expect(parseM3U(`#EXTINF:-1,A
https://a.com/1.m3u8
#EXTINF:-1,B
https://a.com/1.m3u8`, 'src').channels.map((c) => c.id)).toEqual([ids[0], `${ids[0]}_2`])
  })

  it('handles CRLF line endings, a BOM and blank lines', () => {
    const playlist = '﻿#EXTM3U\r\n\r\n#EXTINF:-1 group-title="Haber",Haber TV\r\nhttps://a.com/h.m3u8\r\n'
    const { channels, categories } = parseM3U(playlist, 'src')
    expect(channels).toHaveLength(1)
    expect(channels[0]).toMatchObject({ name: 'Haber TV', streamUrl: 'https://a.com/h.m3u8', group: 'Haber' })
    expect(categories.map((c) => c.name)).toEqual(['Haber'])
  })

  it('detects group type from the URLs of the whole group', () => {
    const playlist = `#EXTINF:-1 group-title="Karışık",A
https://a.com/a.mkv?token=1
#EXTINF:-1 group-title="Karışık",B
https://a.com/b.mp4
#EXTINF:-1 group-title="Karışık",C
https://a.com/c.m3u8
#EXTINF:-1 group-title="Arşiv",D
https://a.com/series/u/p/1.mkv`
    const { channels, categories } = parseM3U(playlist, 'src')
    expect(categories.map((c) => [c.name, c.type])).toEqual([['Karışık', 'vod'], ['Arşiv', 'series']])
    expect(channels.map((c) => c.type)).toEqual(['vod', 'vod', 'vod', 'series'])
  })

  it('reads the request headers a list names for an entry, in every form lists use', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="a" http-user-agent="UA Bir" http-referrer="https://site.example/a",Kanal A',
      'http://example.com/a.m3u8',
      '#EXTINF:-1,Kanal B',
      '#EXTVLCOPT:http-user-agent=UA İki olmaz',
      '#EXTVLCOPT:http-referrer=https://site.example/b',
      '#EXTVLCOPT:http-origin=https://site.example',
      'http://example.com/b.m3u8',
      '#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=UA%20Uc&Referer=https%3A%2F%2Fsite.example%2Fc',
      '#EXTINF:-1,Kanal C',
      'http://example.com/c.m3u8',
      '#EXTINF:-1,Kanal D',
      '#EXTHTTP:{"User-Agent":"UA Dort","cookie":"gizli=1"}',
      'http://example.com/d.m3u8|Referer=https://site.example/d&User-Agent=UA%20Bar',
      '#EXTINF:-1,Kanal E',
      'http://example.com/e.m3u8'
    ].join('\n')
    const { channels } = parseM3U(playlist, 's')
    expect(channels.map((channel) => [channel.name, channel.streamUrl, channel.httpHeaders])).toEqual([
      ['Kanal A', 'http://example.com/a.m3u8', { userAgent: 'UA Bir', referer: 'https://site.example/a' }],
      // The user agent is not plain ASCII and is dropped; the rest stays.
      ['Kanal B', 'http://example.com/b.m3u8', { referer: 'https://site.example/b', origin: 'https://site.example' }],
      ['Kanal C', 'http://example.com/c.m3u8', { userAgent: 'UA Uc', referer: 'https://site.example/c' }],
      // The address ends at the bar; what follows the bar wins; a cookie is not taken.
      ['Kanal D', 'http://example.com/d.m3u8', { userAgent: 'UA Bar', referer: 'https://site.example/d' }],
      // Nothing carries over to the next entry.
      ['Kanal E', 'http://example.com/e.m3u8', undefined]
    ])
  })

  it('parses a playlist with 100k+ entries', () => {
    const lines = ['#EXTM3U']
    for (let i = 0; i < 120_000; i++) {
      lines.push(`#EXTINF:-1 tvg-id="k${i}" tvg-logo="https://img.example/${i}.png" group-title="Grup ${i % 50}",Kanal ${i}`)
      lines.push(`https://cdn.example.com/live/user/pass/${i}.ts`)
    }

    const started = Date.now()
    const { channels, categories } = parseM3U(lines.join('\n'), 'src')
    const elapsed = Date.now() - started

    expect(channels).toHaveLength(120_000)
    expect(categories).toHaveLength(50)
    expect(channels[119_999]).toMatchObject({ name: 'Kanal 119999', epgChannelId: 'k119999', group: 'Grup 49' })
    expect(new Set(channels.map((c) => c.id)).size).toBe(120_000)
    // Generous bound: catches accidental quadratic work, not machine speed.
    expect(elapsed).toBeLessThan(10_000)
  })
})

describe('fetchM3uStreamed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts playlists larger than the old 20 MB limit', async () => {
    const entry = '#EXTINF:-1 group-title="Grup",Kanal\nhttps://cdn.example.com/live/1.ts\n'
    const chunk = new TextEncoder().encode(entry.repeat(10_000))
    const totalBytes = 22 * 1024 * 1024
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalBytes) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
        sent += chunk.length
      }
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))

    const { channels } = await fetchM3uStreamed('https://example.com/list.m3u', 'src')
    expect(channels.length).toBeGreaterThan(20 * 1024 * 1024 / entry.length)
  })

  it('names the host of a playlist that could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchM3uStreamed('https://Liste.Example/get.php?password=x', 'src')).rejects.toMatchObject({
      kind: 'network',
      host: 'liste.example'
    })
  })

  it('reports a failed download with a Turkish message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))))
    await expect(fetchM3uStreamed('https://example.com/list.m3u', 'src')).rejects.toThrow(
      'M3U listesi indirilemedi (HTTP 404)'
    )
  })
})
