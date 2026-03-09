import { describe, expect, it } from 'vitest'
import {
  collectTrackLanguages,
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
