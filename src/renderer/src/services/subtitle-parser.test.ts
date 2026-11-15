import { describe, expect, it } from 'vitest'
import { parseASS, parseSRT, parseSubtitles, parseVTT } from './subtitle-parser'

describe('parseSRT', () => {
  it('parses standard cues and strips HTML tags', () => {
    const cues = parseSRT(`1
00:00:01,000 --> 00:00:03,500
<i>Merhaba</i> dünya

2
00:01:02,250 --> 00:01:04,000
İkinci satır
devamı`)

    expect(cues).toEqual([
      { startTime: 1, endTime: 3.5, text: 'Merhaba dünya' },
      { startTime: 62.25, endTime: 64, text: 'İkinci satır\ndevamı' }
    ])
  })

  it('accepts single-digit hours, short fractions, dots and missing fractions', () => {
    // These were silently dropped by the old two-digit/three-digit-only pattern.
    const cues = parseSRT(`1
0:01:02,50 --> 0:01:04,5
Bir

2
00:00:05.120 --> 00:00:06.000
İki

3
00:00:07 --> 00:00:08
Üç

4
01:02,000 --> 01:03,000
Dört`)

    expect(cues.map((cue) => [cue.startTime, cue.endTime, cue.text])).toEqual([
      [62.5, 64.5, 'Bir'],
      [5.12, 6, 'İki'],
      [7, 8, 'Üç'],
      [62, 63, 'Dört']
    ])
  })

  it('handles CRLF line endings, a BOM and cues without a sequence number', () => {
    const cues = parseSRT('\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nBir\r\n\r\n00:00:03,000 --> 00:00:04,000\r\nİki\r\n')
    expect(cues).toEqual([
      { startTime: 1, endTime: 2, text: 'Bir' },
      { startTime: 3, endTime: 4, text: 'İki' }
    ])
  })

  it('skips malformed blocks and keeps the valid ones', () => {
    const cues = parseSRT(`1
bozuk zaman satırı
metin

2

3
00:00:05,000 --> 00:00:06,000
Geçerli

çöp`)

    expect(cues).toEqual([{ startTime: 5, endTime: 6, text: 'Geçerli' }])
  })

  it('returns no cues for empty or garbage input', () => {
    expect(parseSRT('')).toEqual([])
    expect(parseSRT('rastgele metin\nbaşka satır')).toEqual([])
  })

  it('parses a large file', () => {
    const blocks: string[] = []
    const pad = (n: number, size = 2) => String(n).padStart(size, '0')
    const stamp = (total: number) =>
      `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)},000`
    for (let i = 0; i < 20_000; i++) {
      blocks.push(`${i + 1}\n${stamp(i * 2)} --> ${stamp(i * 2 + 1)}\nSatır ${i}`)
    }

    const cues = parseSRT(blocks.join('\n\n'))

    expect(cues).toHaveLength(20_000)
    expect(cues[19_999]).toEqual({ startTime: 39_998, endTime: 39_999, text: 'Satır 19999' })
  })
})

describe('parseVTT', () => {
  it('parses cues with identifiers, settings and short timestamps', () => {
    const cues = parseVTT(`WEBVTT - başlık

NOTE bu bir not
ikinci not satırı

giris
00:00:01.000 --> 00:00:02.500 align:start
Merhaba

00:03.000 --> 00:04.000
<b>Kısa</b> biçim`)

    expect(cues).toEqual([
      { startTime: 1, endTime: 2.5, text: 'Merhaba' },
      { startTime: 3, endTime: 4, text: 'Kısa biçim' }
    ])
  })

  it('parses a VTT file that starts with a BOM', () => {
    const cues = parseVTT('\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nBir\r\n')
    expect(cues).toEqual([{ startTime: 1, endTime: 2, text: 'Bir' }])
  })
})

describe('parseASS', () => {
  it('parses dialogue lines with styles and override tags', () => {
    const cues = parseASS(`[Script Info]
Title: Deneme

[V4+ Styles]
Format: Name, Fontname, Fontsize, Bold, Italic, Alignment, MarginV
Style: Default,Arial,48,-1,0,2,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8}Merhaba,\\Ndünya`)

    expect(cues).toEqual([
      {
        startTime: 1.5,
        endTime: 3,
        text: 'Merhaba,\ndünya',
        style: { fontSize: '48px', bold: true, italic: false, alignment: 2, marginV: 20 }
      }
    ])
  })

  it('ignores dialogue before a Format line', () => {
    expect(parseASS('[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Metin')).toEqual([])
  })
})

describe('parseSubtitles', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBir'

  it('chooses the parser by extension', () => {
    expect(parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nBir', 'film.SRT')).toHaveLength(1)
    expect(parseSubtitles(vtt, 'film.vtt')).toHaveLength(1)
  })

  it('detects VTT without an extension even when the file starts with a BOM', () => {
    // The BOM made startsWith('WEBVTT') fail, so the file went to the SRT
    // parser, which drops VTT's short mm:ss.ttt timestamps.
    expect(parseSubtitles(`\uFEFF${vtt}`, 'altyazi')).toEqual([{ startTime: 1, endTime: 2, text: 'Bir' }])
    expect(parseSubtitles('\uFEFFWEBVTT\n\n00:01.000 --> 00:02.000\nKısa', 'altyazi')).toEqual([
      { startTime: 1, endTime: 2, text: 'Kısa' }
    ])
  })

  it('detects ASS without an extension', () => {
    const ass = `[Script Info]
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,Bir`
    expect(parseSubtitles(ass, 'altyazi')).toEqual([{ startTime: 1, endTime: 2, text: 'Bir', style: undefined }])
  })

  it('falls back to SRT for unknown content', () => {
    expect(parseSubtitles('1\n0:00:01,5 --> 0:00:02,0\nBir', 'altyazi')).toEqual([
      { startTime: 1.5, endTime: 2, text: 'Bir' }
    ])
    expect(parseSubtitles('tamamen bozuk', 'altyazi')).toEqual([])
  })
})
