import { describe, expect, it } from 'vitest'
import type { AudioTrack, SubtitleTrack } from '@/types/player'
import { AUTO_VIDEO_QUALITY_ID } from '@/services/quality'
import {
  FRESH_TRACK_PREFERENCES,
  normalizeVideoQualitySelection,
  reconcileAudioSelection,
  reconcileSubtitleSelection,
  type TrackSelectionContext
} from './track-reconciler'

function context(overrides: Partial<TrackSelectionContext> = {}): TrackSelectionContext {
  return {
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    isSubtitleTrackUserChoice: false,
    settings: { preferredAudioLanguage: 'tr', preferredSubtitleLanguage: 'tr', defaultSubtitleEnabled: true },
    ...overrides
  }
}

const audio: AudioTrack[] = [
  { id: 'hls-a:0', name: 'English', lang: 'en', default: true },
  { id: 'hls-a:1', name: 'Türkçe', lang: 'tur' }
]
const subtitles: SubtitleTrack[] = [
  { id: 'mpv-s:1', name: 'English', lang: 'en', type: 'embedded' },
  { id: 'mpv-s:2', name: 'Türkçe', lang: 'tr', type: 'embedded' }
]
const applied = { ...FRESH_TRACK_PREFERENCES, audioPreferenceApplied: true, subtitlePreferenceApplied: true }

describe('reconcileAudioSelection', () => {
  it('applies the preferred language once per item', () => {
    const first = reconcileAudioSelection(audio, null, context(), FRESH_TRACK_PREFERENCES)
    expect(first.track).toBe('hls-a:1')
    expect(first.state.audioPreferenceApplied).toBe(true)
  })

  it('keeps a valid selection', () => {
    const result = reconcileAudioSelection(audio, 'hls-a:1', context({ currentAudioTrack: 'hls-a:0' }), applied)
    expect(result.track).toBeUndefined()
  })

  it('falls back to what the engine plays, then the default track, once the preference is spent', () => {
    expect(reconcileAudioSelection(audio, 'hls-a:1', context(), applied).track).toBe('hls-a:1')
    expect(reconcileAudioSelection(audio, null, context({ currentAudioTrack: 'hls-a:9' }), applied).track).toBe('hls-a:0')
  })

  it('clears the selection for a stream without audio tracks', () => {
    expect(reconcileAudioSelection([], null, context({ currentAudioTrack: 'hls-a:0' }), applied).track).toBeNull()
  })
})

describe('reconcileSubtitleSelection', () => {
  it('keeps the preference for a list that arrives later', () => {
    const empty = reconcileSubtitleSelection([], null, context(), FRESH_TRACK_PREFERENCES)
    expect(empty.track).toBeUndefined()
    expect(empty.state.subtitlePreferenceApplied).toBe(false)

    const loaded = reconcileSubtitleSelection(subtitles, null, context(), empty.state)
    expect(loaded.track).toBe('mpv-s:2')
    expect(loaded.state.subtitlePreferenceApplied).toBe(true)
  })

  it('never applies the preference over a choice the viewer made', () => {
    const result = reconcileSubtitleSelection(
      subtitles,
      null,
      context({ isSubtitleTrackUserChoice: true }),
      FRESH_TRACK_PREFERENCES
    )
    expect(result.track).toBeUndefined()
    expect(result.state.subtitlePreferenceApplied).toBe(true)
  })

  it('does not switch subtitles back on after the viewer turned them off', () => {
    // mpv has not processed "sid=no" yet and still reports the old track.
    const result = reconcileSubtitleSelection(subtitles, 'mpv-s:2', context({ isSubtitleTrackUserChoice: true }), applied)
    expect(result.track).toBeUndefined()
  })

  it('mirrors a subtitle the engine picked while nobody chose one', () => {
    expect(reconcileSubtitleSelection(subtitles, 'mpv-s:1', context(), applied).track).toBe('mpv-s:1')
  })

  it('turns off an engine-picked subtitle when the setting says off, and keeps it off', () => {
    const off = context({
      settings: { preferredAudioLanguage: 'tr', preferredSubtitleLanguage: 'tr', defaultSubtitleEnabled: false }
    })
    const first = reconcileSubtitleSelection(subtitles, 'mpv-s:1', off, FRESH_TRACK_PREFERENCES)
    expect(first.disableEngineSubtitles).toBe(true)
    expect(first.track).toBeUndefined()
    expect(reconcileSubtitleSelection(subtitles, 'mpv-s:1', off, first.state).track).toBeUndefined()
  })

  it('keeps a loaded subtitle file whatever the stream lists', () => {
    const external = context({ currentSubtitleTrack: 'external' })
    expect(reconcileSubtitleSelection([], null, external, applied).track).toBeUndefined()
    expect(reconcileSubtitleSelection(subtitles, null, external, applied).track).toBeUndefined()
  })

  it('clears a selection the stream no longer has', () => {
    expect(reconcileSubtitleSelection(subtitles, null, context({ currentSubtitleTrack: 'hls:4' }), applied).track).toBeNull()
  })
})

describe('normalizeVideoQualitySelection', () => {
  const options = [
    { id: AUTO_VIDEO_QUALITY_ID, label: 'Otomatik', shortLabel: 'Oto', auto: true },
    { id: 'hls-v:0', label: '1080p', shortLabel: '1080p' }
  ]

  it('has none without options, keeps a valid choice, and falls back to automatic', () => {
    expect(normalizeVideoQualitySelection([], 'hls-v:0')).toBeNull()
    expect(normalizeVideoQualitySelection(options, 'hls-v:0')).toBe('hls-v:0')
    expect(normalizeVideoQualitySelection(options, 'hls-v:7')).toBe(AUTO_VIDEO_QUALITY_ID)
    expect(normalizeVideoQualitySelection(options, null)).toBe(AUTO_VIDEO_QUALITY_ID)
  })
})
