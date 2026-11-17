// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyStreamProperty,
  describeMpvFileError,
  emptyStreamState,
  normalizeTracks,
  subtitleStyleProperties
} from './stream-state'

describe('applyStreamProperty', () => {
  it('clears a value mpv reports as unavailable instead of keeping the old one', () => {
    // Keeping the previous value is how one channel's position and duration
    // leaked into the next channel's resume point.
    const state = emptyStreamState()
    applyStreamProperty(state, 'time-pos', 1234.5)
    applyStreamProperty(state, 'duration', 3600)
    applyStreamProperty(state, 'aid', 2)
    applyStreamProperty(state, 'path', 'http://a.test/1.ts')

    applyStreamProperty(state, 'time-pos', undefined)
    applyStreamProperty(state, 'duration', undefined)
    applyStreamProperty(state, 'aid', undefined)
    applyStreamProperty(state, 'path', undefined)

    expect(state).toEqual(emptyStreamState())
  })

  it('reads buffering and cache length from demuxer-cache-state', () => {
    const state = emptyStreamState()
    applyStreamProperty(state, 'demuxer-cache-state', { underrun: true, 'cache-duration': 4.5 })
    expect(state.buffering).toBe(true)
    expect(state.demuxerCacheDuration).toBe(4.5)
    applyStreamProperty(state, 'demuxer-cache-state', undefined)
    expect(state.buffering).toBe(false)
    expect(state.demuxerCacheDuration).toBe(0)
  })
})

describe('normalizeTracks', () => {
  it('keeps real tracks and drops cover art and malformed entries', () => {
    const tracks = normalizeTracks([
      { id: 1, type: 'video', codec: 'h264', 'demux-w': 1920, 'demux-h': 1080, selected: true },
      { id: 2, type: 'video', albumart: true },
      { id: 1, type: 'audio', lang: 'tur', 'hls-bitrate': 128000 },
      { id: 0, type: 'sub' },
      { id: 3, type: 'other' },
      null
    ])
    expect(tracks).toEqual([
      expect.objectContaining({ id: 1, type: 'video', width: 1920, height: 1080, selected: true }),
      expect.objectContaining({ id: 1, type: 'audio', lang: 'tur', bitrate: 128000, selected: false })
    ])
  })
})

describe('describeMpvFileError', () => {
  it('maps known libmpv errors and passes unknown ones through', () => {
    expect(describeMpvFileError('loading failed')).toBe(
      'Yayın açılamadı. Kaynak yanıt vermiyor veya adres geçersiz.'
    )
    expect(describeMpvFileError('http 403')).toBe('Yayın açılamadı: http 403')
    expect(describeMpvFileError(undefined)).toBe('Yayın açılamadı.')
  })
})

describe('subtitleStyleProperties', () => {
  it('converts CSS colours to mpv colours', () => {
    const properties = new Map(
      subtitleStyleProperties({ fontSize: 24, color: '#fff', background: 'rgba(0,0,0,0.5)' })
    )
    expect(properties.get('sub-color')).toBe('#FFFFFF')
    // mpv's order: alpha first.
    expect(properties.get('sub-back-color')).toBe('#80000000')
    expect(properties.get('sub-scale')).toBe(1)
  })

  it('draws the background as a box, which is the only style mpv fills it in', () => {
    const properties = new Map(
      subtitleStyleProperties({ fontSize: 24, color: '#ffffff', background: 'rgba(0,0,0,0.75)' })
    )
    expect(properties.get('sub-border-style')).toBe('background-box')
    expect(properties.get('sub-back-color')).toBe('#BF000000')
    expect(properties.get('sub-shadow-offset')).toBeGreaterThan(0)
    expect(properties.get('sub-border-size')).toBe(0)
  })

  it('outlines the text in black when the background is fully transparent', () => {
    const properties = new Map(
      subtitleStyleProperties({ fontSize: 24, color: '#ffffff', background: 'rgba(0,0,0,0.00)' })
    )
    expect(properties.get('sub-border-style')).toBe('outline-and-shadow')
    expect(properties.get('sub-border-size')).toBeGreaterThan(0)
    expect(properties.get('sub-border-color')).toBe('#FF000000')
    expect(properties.get('sub-shadow-offset')).toBe(0)
  })

  it('grows with the size setting once: the font size follows it, the scale stays 1', () => {
    const at = (fontSize: number) =>
      new Map(subtitleStyleProperties({ fontSize, color: '#ffffff', background: 'rgba(0,0,0,0.75)' }))
    expect(at(48).get('sub-scale')).toBe(1)
    expect(at(48).get('sub-font-size')).toBe(2 * (at(24).get('sub-font-size') as number))
  })
})
