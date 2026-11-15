import { describe, expect, it } from 'vitest'
import {
  collectTrackLanguages,
  normalizeLanguageCode,
  pickPreferredAudioTrackId,
  pickPreferredSubtitleTrackId
} from './track-preferences'

describe('track-preferences', () => {
  it('prefers an audio track that matches the selected language', () => {
    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a1', name: 'English', lang: 'en', default: true },
          { id: 'a2', name: 'Turkish', lang: 'tr-TR' }
        ],
        'tr'
      )
    ).toBe('a2')
  })

  it('falls back to default audio and then first audio track', () => {
    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a1', name: 'English', lang: 'en', default: true },
          { id: 'a2', name: 'German', lang: 'de' }
        ],
        'fr'
      )
    ).toBe('a1')

    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a5', name: 'Spanish', lang: 'es' },
          { id: 'a6', name: 'German', lang: 'de' }
        ],
        'fr'
      )
    ).toBe('a5')
  })

  it('picks subtitle track by language and keeps ids stringified', () => {
    expect(
      pickPreferredSubtitleTrackId(
        [
          { id: 5, name: 'English CC', lang: 'en-US', type: 'embedded' },
          { id: 7, name: 'Turkish', lang: 'tr', type: 'embedded' }
        ],
        'tr'
      )
    ).toBe('7')
  })

  it('matches two-letter preferences against three-letter container codes', () => {
    // The menus store "tr"/"en"; MKV and MPEG-TS tracks report "tur"/"eng".
    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a1', name: 'English', lang: 'eng', default: true },
          { id: 'a2', name: 'Türkçe', lang: 'tur' }
        ],
        'tr'
      )
    ).toBe('a2')

    expect(
      pickPreferredSubtitleTrackId(
        [
          { id: 1, name: 'Deutsch', lang: 'ger', type: 'embedded' },
          { id: 2, name: 'English', lang: 'ENG', type: 'embedded' }
        ],
        'en'
      )
    ).toBe('2')
  })

  it('matches bibliographic and terminological ISO 639-2 forms', () => {
    const tracks = [
      { id: 'a1', name: 'Français', lang: 'fre' },
      { id: 'a2', name: 'Deutsch', lang: 'deu' }
    ]
    expect(pickPreferredAudioTrackId(tracks, 'fra')).toBe('a1')
    expect(pickPreferredAudioTrackId(tracks, 'de')).toBe('a2')
    expect(pickPreferredAudioTrackId(tracks, 'ger')).toBe('a2')
  })

  it('keeps regional-form matching after normalization', () => {
    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a1', name: 'English', lang: 'en-GB' },
          { id: 'a2', name: 'Português', lang: 'por_BR' }
        ],
        'pt'
      )
    ).toBe('a2')
    expect(
      pickPreferredSubtitleTrackId([{ id: 3, name: 'Türkçe', lang: 'tur', type: 'embedded' }], 'tr-TR')
    ).toBe('3')
    // Different regions of the same language are not merged.
    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a1', name: 'US', lang: 'en-us' },
          { id: 'a2', name: 'GB', lang: 'en-gb', default: true }
        ],
        'en-au'
      )
    ).toBe('a2')
  })

  it('never matches the auto preference', () => {
    expect(
      pickPreferredAudioTrackId(
        [
          { id: 'a1', name: 'Turkish', lang: 'tur' },
          { id: 'a2', name: 'English', lang: 'eng', default: true }
        ],
        'auto'
      )
    ).toBe('a2')
  })

  it('collects unique normalized language tags in insertion order', () => {
    expect(
      collectTrackLanguages([
        { lang: 'TR' },
        { lang: 'tr-tr' },
        { lang: ' en ' },
        { lang: 'TR' },
        { lang: undefined }
      ])
    ).toEqual(['tr', 'tr-tr', 'en'])
  })
})

describe('normalizeLanguageCode', () => {
  it('maps ISO 639-2 and common names to ISO 639-1', () => {
    expect(normalizeLanguageCode('tur')).toBe('tr')
    expect(normalizeLanguageCode('TUR')).toBe('tr')
    expect(normalizeLanguageCode('Turkish')).toBe('tr')
    expect(normalizeLanguageCode('eng')).toBe('en')
    expect(normalizeLanguageCode('ger')).toBe('de')
    expect(normalizeLanguageCode('deu')).toBe('de')
    expect(normalizeLanguageCode('fre')).toBe('fr')
    expect(normalizeLanguageCode('fra')).toBe('fr')
  })

  it('keeps regional subtags and reads underscores as dashes', () => {
    expect(normalizeLanguageCode('tr-TR')).toBe('tr-tr')
    expect(normalizeLanguageCode('por_BR')).toBe('pt-br')
    expect(normalizeLanguageCode('en_US')).toBe('en-us')
  })

  it('passes unknown tags through and handles empty input', () => {
    expect(normalizeLanguageCode('xyz')).toBe('xyz')
    expect(normalizeLanguageCode(' ')).toBe('')
    expect(normalizeLanguageCode(undefined)).toBe('')
    expect(normalizeLanguageCode(null)).toBe('')
  })
})
