import type Hls from 'hls.js'
import type { AudioTrack, SubtitleCue, SubtitleTrack } from '@/types/player'
import type { EmbeddedSubtitleProbeTrack } from '@/services/platform'
import { GENERATED_CAPTIONS_TRACK_LABEL } from '@/constants/captions'
import {
  HLS_AUDIO_PREFIX,
  HLS_SUBTITLE_PREFIX,
  NATIVE_AUDIO_PREFIX,
  NATIVE_SUBTITLE_PREFIX,
  PROBED_SUBTITLE_PREFIX,
  trackId
} from './track-ids'
import { strings } from '@/strings'

/**
 * Track lists of the `<video>` element and hls.js, mapped to store tracks, and
 * the selections applied back to them. Subtitles are never drawn by the
 * element: the selected text track is kept `hidden` and its cues are rendered
 * by the player's own overlay.
 */

type NativeAudioTrackLike = {
  enabled?: boolean
  label?: string
  language?: string
}

export type NativeAudioTrackListLike = {
  length: number
  [index: number]: NativeAudioTrackLike
  addEventListener?: (type: 'addtrack' | 'removetrack' | 'change', listener: () => void) => void
  removeEventListener?: (type: 'addtrack' | 'removetrack' | 'change', listener: () => void) => void
}

/** The `<track>` the player generates for parsed cues is not a stream track. */
export function isSubtitleTextTrack(track: TextTrack): boolean {
  return track.label !== GENERATED_CAPTIONS_TRACK_LABEL && (track.kind === 'subtitles' || track.kind === 'captions')
}

/** Index and item of a DOM-style list; an index the list no longer has is skipped. */
function listEntries<T>(list: { readonly length: number; readonly [index: number]: T | undefined }): Array<[number, T]> {
  const entries: Array<[number, T]> = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (item !== undefined) entries.push([i, item])
  }
  return entries
}

function normalizeTrackMeta(value: string | undefined): string {
  return value?.trim().toLowerCase() || ''
}

export function getNativeAudioTracks(video: HTMLVideoElement): NativeAudioTrackListLike | null {
  const maybeTracks = (video as HTMLVideoElement & { audioTracks?: NativeAudioTrackListLike }).audioTracks
  if (!maybeTracks || typeof maybeTracks.length !== 'number') return null
  return maybeTracks
}

export function collectNativeSubtitleTracks(video: HTMLVideoElement): SubtitleTrack[] {
  const tracks = video.textTracks
  if (!tracks || tracks.length === 0) return []

  const nativeTracks: SubtitleTrack[] = []
  for (const [i, track] of listEntries(tracks)) {
    if (!isSubtitleTextTrack(track)) continue

    nativeTracks.push({
      id: trackId(NATIVE_SUBTITLE_PREFIX, i),
      name: track.label || track.language || strings.player.subtitles.fallback(i + 1),
      lang: track.language || undefined,
      type: 'embedded'
    })
  }

  return nativeTracks
}

export function collectHlsSubtitleTracks(hls: Hls): SubtitleTrack[] {
  const tracks = hls.subtitleTracks || []
  return tracks.map((track, index) => ({
    id: trackId(HLS_SUBTITLE_PREFIX, index),
    name: track.name || track.lang || strings.player.subtitles.fallback(index + 1),
    lang: track.lang,
    type: 'embedded'
  }))
}

/** Subtitle streams ffprobe found in a direct file; extracted on selection. */
export function collectProbedSubtitleTracks(tracks: EmbeddedSubtitleProbeTrack[]): SubtitleTrack[] {
  return tracks.map((track, index) => {
    const lang = track.language?.trim()
    const title = track.title?.trim()
    const codec = track.codec?.trim()
    const nameParts = [lang ? lang.toUpperCase() : '', title || '', codec ? `(${codec})` : ''].filter(Boolean)
    return {
      id: trackId(PROBED_SUBTITLE_PREFIX, track.index),
      name: nameParts.join(' ') || strings.player.subtitles.fallback(index + 1),
      lang: lang || undefined,
      type: 'embedded'
    }
  })
}

export function collectNativeAudioTracks(video: HTMLVideoElement): AudioTrack[] {
  const tracks = getNativeAudioTracks(video)
  if (!tracks || tracks.length === 0) return []

  const nativeTracks: AudioTrack[] = []
  for (const [i, track] of listEntries(tracks)) {
    nativeTracks.push({
      id: trackId(NATIVE_AUDIO_PREFIX, i),
      name: track.label || track.language || strings.player.audio.fallback(i + 1),
      lang: track.language || undefined,
      default: !!track.enabled
    })
  }

  return nativeTracks
}

export function collectHlsAudioTracks(hls: Hls): AudioTrack[] {
  const tracks = hls.audioTracks || []
  return tracks.map((track, index) => ({
    id: trackId(HLS_AUDIO_PREFIX, index),
    name: track.name || track.lang || strings.player.audio.fallback(index + 1),
    lang: track.lang,
    default: !!track.default
  }))
}

/**
 * The store's subtitle list for an HTML5 stream: hls.js's own list when it
 * has one (the element mirrors it), else the element's, plus probed streams.
 */
export function mergeHtml5SubtitleTracks(
  hlsTracks: SubtitleTrack[],
  nativeTracks: SubtitleTrack[],
  probedTracks: SubtitleTrack[]
): SubtitleTrack[] {
  return [...hlsTracks, ...(hlsTracks.length > 0 ? [] : nativeTracks), ...probedTracks]
}

export function syncActiveSubtitleCues(
  video: HTMLVideoElement,
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
): void {
  const nextCues: SubtitleCue[] = []
  const tracks = video.textTracks

  for (const [, track] of listEntries(tracks)) {
    if (!isSubtitleTextTrack(track)) continue
    if (track.mode !== 'hidden' && track.mode !== 'showing') continue
    if (!track.activeCues) continue

    for (const [, activeCue] of listEntries(track.activeCues)) {
      const cue = activeCue as unknown as { startTime?: number; endTime?: number; text?: string }
      if (typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') continue
      nextCues.push({
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cue.text || ''
      })
    }
  }

  setActiveSubtitleCues(nextCues)
}

export function attachCueListeners(
  video: HTMLVideoElement,
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
): void {
  for (const [, track] of listEntries(video.textTracks)) {
    if (!isSubtitleTextTrack(track)) continue
    track.oncuechange = () => syncActiveSubtitleCues(video, setActiveSubtitleCues)
  }
}

export function disableAllNativeSubtitleTracks(video: HTMLVideoElement): void {
  for (const [, track] of listEntries(video.textTracks)) {
    if (!isSubtitleTextTrack(track)) continue
    track.mode = 'disabled'
  }
}

export function applyNativeSubtitleTrack(video: HTMLVideoElement, nativeTrackIndex: number): void {
  for (const [i, track] of listEntries(video.textTracks)) {
    if (!isSubtitleTextTrack(track)) continue
    // Keep selected track hidden and render all subtitles via custom overlay.
    track.mode = i === nativeTrackIndex ? 'hidden' : 'disabled'
  }
}

export function applyNativeAudioTrack(video: HTMLVideoElement, nativeTrackIndex: number): void {
  const tracks = getNativeAudioTracks(video)
  if (!tracks) return

  for (const [i, track] of listEntries(tracks)) {
    track.enabled = i === nativeTrackIndex
  }
}

/**
 * hls.js renders its subtitle tracks as element text tracks; find the one that
 * belongs to hls track `hlsTrackId` by language and name, then by position.
 */
export function findNativeSubtitleTrackIndexForHls(
  video: HTMLVideoElement,
  hls: Pick<Hls, 'subtitleTracks'>,
  hlsTrackId: number
): number {
  const hlsTrack = hls.subtitleTracks?.[hlsTrackId]
  const targetLang = normalizeTrackMeta(hlsTrack?.lang)
  const targetName = normalizeTrackMeta(hlsTrack?.name)
  const subtitleTracks: Array<[number, TextTrack]> = []

  for (const [i, nativeTrack] of listEntries(video.textTracks)) {
    if (!isSubtitleTextTrack(nativeTrack)) continue

    subtitleTracks.push([i, nativeTrack])

    const nativeLang = normalizeTrackMeta(nativeTrack.language)
    const nativeLabel = normalizeTrackMeta(nativeTrack.label)
    if (targetLang && targetName && nativeLang === targetLang && nativeLabel === targetName) {
      return i
    }
  }

  if (targetLang) {
    for (const [index, nativeTrack] of subtitleTracks) {
      if (normalizeTrackMeta(nativeTrack.language) === targetLang) return index
    }
  }

  if (targetName) {
    for (const [index, nativeTrack] of subtitleTracks) {
      if (normalizeTrackMeta(nativeTrack.label) === targetName) return index
    }
  }

  // Then by position among the element's subtitle tracks, else the first one.
  return (subtitleTracks[hlsTrackId] ?? subtitleTracks[0])?.[0] ?? -1
}

/** Returns false while the element has no text track for it yet. */
export function applyHlsSubtitleTrack(
  video: HTMLVideoElement,
  hls: Hls,
  hlsTrackId: number,
  setActiveSubtitleCues: (cues: SubtitleCue[]) => void
): boolean {
  hls.subtitleTrack = hlsTrackId
  hls.subtitleDisplay = true

  const nativeTrackId = findNativeSubtitleTrackIndexForHls(video, hls, hlsTrackId)
  if (nativeTrackId >= 0) {
    applyNativeSubtitleTrack(video, nativeTrackId)
    syncActiveSubtitleCues(video, setActiveSubtitleCues)
    return true
  }

  disableAllNativeSubtitleTracks(video)
  setActiveSubtitleCues([])
  return false
}

/** Turns hls.js's own subtitle selection off (the player shows another source). */
export function disableHlsSubtitles(hls: Hls | null): void {
  if (!hls) return
  hls.subtitleTrack = -1
  hls.subtitleDisplay = false
}
