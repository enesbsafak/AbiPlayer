import { describe, expect, it } from 'vitest'
import { GENERATED_CAPTIONS_TRACK_LABEL } from '@/constants/captions'
import {
  applyNativeSubtitleTrack,
  collectNativeSubtitleTracks,
  collectProbedSubtitleTracks,
  findNativeSubtitleTrackIndexForHls,
  mergeHtml5SubtitleTracks
} from './html5-tracks'
import { legacyTrackIndex, trackIndex } from './track-ids'

type FakeTextTrack = { kind: string; label: string; language: string; mode: TextTrackMode }

function videoWith(tracks: FakeTextTrack[]): HTMLVideoElement {
  const list = Object.assign([...tracks], {}) as unknown as TextTrackList
  return { textTracks: list } as unknown as HTMLVideoElement
}

const generated: FakeTextTrack = { kind: 'captions', label: GENERATED_CAPTIONS_TRACK_LABEL, language: 'und', mode: 'hidden' }

describe('native text tracks', () => {
  it('lists stream subtitles but not the track the player generates for parsed cues', () => {
    const video = videoWith([generated, { kind: 'subtitles', label: 'Türkçe', language: 'tr', mode: 'disabled' }])
    expect(collectNativeSubtitleTracks(video)).toEqual([
      { id: 'native:1', name: 'Türkçe', lang: 'tr', type: 'embedded' }
    ])
  })

  it('keeps the selected track hidden for the overlay and leaves the generated one alone', () => {
    const tracks: FakeTextTrack[] = [
      { ...generated },
      { kind: 'subtitles', label: 'A', language: 'en', mode: 'showing' },
      { kind: 'subtitles', label: 'B', language: 'tr', mode: 'disabled' }
    ]
    applyNativeSubtitleTrack(videoWith(tracks), 2)
    expect(tracks.map((track) => track.mode)).toEqual(['hidden', 'disabled', 'hidden'])
  })

  it('finds the element track of an hls subtitle by language and name, then by position', () => {
    const video = videoWith([
      generated,
      { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
      { kind: 'subtitles', label: 'Türkçe', language: 'tr', mode: 'disabled' }
    ])
    const hls = { subtitleTracks: [{ lang: 'en', name: 'English' }, { lang: 'tr', name: 'Türkçe' }] }
    expect(findNativeSubtitleTrackIndexForHls(video, hls as never, 1)).toBe(2)
    expect(findNativeSubtitleTrackIndexForHls(video, { subtitleTracks: [{}, {}] } as never, 1)).toBe(2)
    expect(findNativeSubtitleTrackIndexForHls(videoWith([generated]), hls as never, 0)).toBe(-1)
  })
})

describe('subtitle lists', () => {
  it('prefers the hls list over the element mirror and appends probed streams', () => {
    const hls = [{ id: 'hls:0', name: 'A', type: 'embedded' as const }]
    const native = [{ id: 'native:0', name: 'A', type: 'embedded' as const }]
    const probed = collectProbedSubtitleTracks([{ index: 3, codec: 'subrip', language: 'tur', title: 'Tam' }])
    expect(probed).toEqual([{ id: 'probe:3', name: 'TUR Tam (subrip)', lang: 'tur', type: 'embedded' }])
    expect(mergeHtml5SubtitleTracks(hls, native, probed).map((track) => track.id)).toEqual(['hls:0', 'probe:3'])
    expect(mergeHtml5SubtitleTracks([], native, []).map((track) => track.id)).toEqual(['native:0'])
  })
})

describe('track ids', () => {
  it('reads the index behind a prefix and old bare numbers', () => {
    expect(trackIndex('probe:12', 'probe:')).toBe(12)
    expect(trackIndex('hls:1', 'probe:')).toBeNull()
    expect(trackIndex(null, 'hls:')).toBeNull()
    expect(legacyTrackIndex('3')).toBe(3)
    expect(legacyTrackIndex('mpv-a:3')).toBeNull()
  })
})
