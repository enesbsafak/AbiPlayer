import { itemAt } from '../../shared/checked'
import type { MpvSubtitleStyle, MpvTrackInfo } from '../../shared/types/electron-ipc'
import { isSubtitleFont } from '../../shared/subtitle-style'
import { mainStrings } from '../../shared/main-strings'

/** Everything that belongs to the file currently loaded, and to nothing else. */
export interface MpvStreamState {
  timePos: number
  duration: number
  demuxerCacheDuration: number
  buffering: boolean
  tracks: MpvTrackInfo[]
  vid: number | null
  aid: number | null
  sid: number | null
  path: string | null
  eofReached: boolean
}

export function emptyStreamState(): MpvStreamState {
  return {
    timePos: 0,
    duration: 0,
    demuxerCacheDuration: 0,
    buffering: false,
    tracks: [],
    vid: null,
    aid: null,
    sid: null,
    path: null,
    eofReached: false
  }
}

/** Properties whose values describe the loaded file. */
export const MPV_STREAM_PROPERTIES = [
  'time-pos',
  'duration',
  'demuxer-cache-state',
  'track-list',
  'vid',
  'aid',
  'sid',
  'path',
  'eof-reached'
] as const

/** Properties of the player itself; they survive a file change. */
export const MPV_PLAYER_PROPERTIES = ['pause', 'volume', 'mute', 'fullscreen'] as const

export type MpvStreamProperty = (typeof MPV_STREAM_PROPERTIES)[number]
export type MpvPlayerProperty = (typeof MPV_PLAYER_PROPERTIES)[number]

export function isStreamProperty(name: unknown): name is MpvStreamProperty {
  return (MPV_STREAM_PROPERTIES as readonly unknown[]).includes(name)
}

export function isPlayerProperty(name: unknown): name is MpvPlayerProperty {
  return (MPV_PLAYER_PROPERTIES as readonly unknown[]).includes(name)
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function trackId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

function normalizeTrackType(value: unknown): 'audio' | 'sub' | 'video' | null {
  if (value === 'audio' || value === 'sub' || value === 'video') return value
  return null
}

export function normalizeTracks(input: unknown): MpvTrackInfo[] {
  if (!Array.isArray(input)) return []

  const tracks: MpvTrackInfo[] = []
  for (const rawTrack of input) {
    if (!rawTrack || typeof rawTrack !== 'object') continue
    const track = rawTrack as Record<string, unknown>

    const type = normalizeTrackType(track.type)
    if (!type) continue

    const id = Number(track.id)
    if (!Number.isInteger(id) || id <= 0) continue
    if (type === 'video' && (track.image === true || track.albumart === true)) continue

    tracks.push({
      id,
      type,
      title: typeof track.title === 'string' ? track.title : undefined,
      lang: typeof track.lang === 'string' ? track.lang : undefined,
      codec: typeof track.codec === 'string' ? track.codec : undefined,
      bitrate: toPositiveNumber(track['hls-bitrate']) ?? toPositiveNumber(track.bitrate),
      width: toPositiveNumber(track['demux-w']) ?? toPositiveNumber(track.w),
      height: toPositiveNumber(track['demux-h']) ?? toPositiveNumber(track.h),
      selected: track.selected === true,
      external: track.external === true
    })
  }

  return tracks
}

function cacheState(data: unknown): { buffering: boolean; duration: number } {
  if (!data || typeof data !== 'object') return { buffering: false, duration: 0 }
  const state = data as Record<string, unknown>
  const raw = state['cache-duration']
  return {
    buffering: state.underrun === true,
    duration: typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0
  }
}

/**
 * Applies one `property-change` to the stream state. `data` is undefined when
 * mpv reports the property as unavailable (no file, or not known yet), which
 * clears the value: keeping the previous one is how one channel's position and
 * duration used to leak into the next.
 */
export function applyStreamProperty(
  state: MpvStreamState,
  name: MpvStreamProperty,
  data: unknown
): void {
  switch (name) {
    case 'time-pos':
      state.timePos = finiteOr(data, 0)
      break
    case 'duration':
      state.duration = finiteOr(data, 0)
      break
    case 'demuxer-cache-state': {
      const cache = cacheState(data)
      state.buffering = cache.buffering
      state.demuxerCacheDuration = cache.duration
      break
    }
    case 'track-list':
      state.tracks = normalizeTracks(data)
      break
    case 'vid':
      state.vid = trackId(data)
      break
    case 'aid':
      state.aid = trackId(data)
      break
    case 'sid':
      state.sid = trackId(data)
      break
    case 'path':
      state.path = typeof data === 'string' && data.length > 0 ? data : null
      break
    case 'eof-reached':
      state.eofReached = data === true
      break
  }
}

export interface MpvPlayerState {
  paused: boolean
  volume: number
  muted: boolean
  fullscreen: boolean
}

export function applyPlayerProperty(
  state: MpvPlayerState,
  name: MpvPlayerProperty,
  data: unknown
): void {
  switch (name) {
    case 'pause':
      if (typeof data === 'boolean') state.paused = data
      break
    case 'volume':
      if (typeof data === 'number' && Number.isFinite(data)) {
        state.volume = Math.max(0, Math.min(100, data))
      }
      break
    case 'mute':
      if (typeof data === 'boolean') state.muted = data
      break
    case 'fullscreen':
      if (typeof data === 'boolean') state.fullscreen = data
      break
  }
}

// mpv reports load/playback failures through the `end-file` IPC event. The
// `file_error` payload is an English libmpv string ("loading failed",
// "unrecognized file format", …) — map the common ones so the UI can show
// something actionable instead of raw engine output.
const MPV_FILE_ERROR_MESSAGES: Record<string, string> = {
  'loading failed': mainStrings.mpv.loadingFailed,
  'unrecognized file format': mainStrings.mpv.unrecognizedFormat,
  'unknown error': mainStrings.mpv.unknownError
}

export function describeMpvFileError(fileError: unknown): string {
  if (typeof fileError !== 'string' || !fileError.trim()) {
    return mainStrings.mpv.openFailed
  }

  const normalized = fileError.trim().toLowerCase()
  return MPV_FILE_ERROR_MESSAGES[normalized] ?? mainStrings.mpv.openFailedWith(fileError.trim().slice(0, 200))
}

function parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const value = input.trim()
  if (!value) return null

  const shortHexMatch = value.match(/^#([0-9a-fA-F]{3})$/)
  if (shortHexMatch) {
    const digits = itemAt(shortHexMatch, 1)
    const channel = (index: number): number => Number.parseInt(digits.charAt(index).repeat(2), 16)
    return { r: channel(0), g: channel(1), b: channel(2), a: 1 }
  }

  const hexMatch = value.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/)
  if (hexMatch) {
    const hex = itemAt(hexMatch, 1)
    const alphaHex = hexMatch[2]
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: alphaHex ? Number.parseInt(alphaHex, 16) / 255 : 1
    }
  }

  const rgbMatch = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)$/i
  )
  if (!rgbMatch) return null

  const r = Math.max(0, Math.min(255, Number.parseInt(itemAt(rgbMatch, 1), 10)))
  const g = Math.max(0, Math.min(255, Number.parseInt(itemAt(rgbMatch, 2), 10)))
  const b = Math.max(0, Math.min(255, Number.parseInt(itemAt(rgbMatch, 3), 10)))
  const alphaRaw = rgbMatch[4] ? Number.parseFloat(rgbMatch[4]) : 1
  const a = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 1

  return { r, g, b, a }
}

/**
 * A CSS colour as mpv writes one: `#RRGGBB`, or with alpha `#AARRGGBB`. The
 * alpha comes first; written last (`#000000BF`), mpv read a 75 % black as a
 * fully transparent blue.
 */
export function toMpvColor(input: string, includeAlpha: boolean, fallback: string): string {
  const color = parseCssColor(input)
  if (!color) return fallback

  const toHex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
  const rgb = `${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
  if (!includeAlpha) return `#${rgb}`
  return `#${toHex(Math.round(color.a * 255))}${rgb}`
}

/** Space between the text and the edge of its background box, in mpv's scaled pixels. */
const SUBTITLE_BOX_PADDING = 6
/** Outline of subtitles drawn without a background, in mpv's scaled pixels. */
const SUBTITLE_OUTLINE_SIZE = 2.4
/** The outline sizes the viewer can ask for by name. */
const SUBTITLE_OUTLINE_SIZES = { thin: 1.4, thick: 4 } as const

/**
 * The mpv properties that render the app's subtitle style.
 *
 * mpv draws the background only with `sub-border-style=background-box`; in the
 * default style `sub-back-color` is the colour of a shadow, which at offset 0
 * is not drawn at all. With the box, `sub-shadow-offset` is its padding. A
 * fully transparent background gets a black outline instead, so the text stays
 * readable over a bright picture.
 *
 * The size is one number: `sub-font-size` follows the setting and `sub-scale`
 * stays 1. Both used to grow with the setting, so the largest size came out
 * four times the default instead of twice.
 */
export function subtitleStyleProperties(style: MpvSubtitleStyle): Array<[string, unknown]> {
  const fontSize = Math.max(10, Math.min(96, Math.round(style.fontSize)))
  const mpvFontSize = Math.max(14, Math.round(fontSize * 2.2))
  const hasBackground = (parseCssColor(style.background)?.a ?? 0.75) > 0.01
  // 'auto': none over a background box, a normal one without it. A size
  // asked for by name is drawn either way (mpv draws it inside the box).
  const outline =
    style.outline === 'thin' || style.outline === 'thick'
      ? SUBTITLE_OUTLINE_SIZES[style.outline]
      : hasBackground
        ? 0
        : SUBTITLE_OUTLINE_SIZE

  return [
    ['sub-font', isSubtitleFont(style.font) && style.font ? style.font : 'sans-serif'],
    ['sub-bold', style.bold === true],
    ['sub-ass-override', 'force'],
    ['sub-scale', 1],
    ['sub-font-size', mpvFontSize],
    ['sub-color', toMpvColor(style.color, false, '#FFFFFF')],
    ['sub-border-style', hasBackground ? 'background-box' : 'outline-and-shadow'],
    ['sub-back-color', toMpvColor(style.background, true, '#BF000000')],
    ['sub-shadow-offset', hasBackground ? SUBTITLE_BOX_PADDING : 0],
    ['sub-border-size', outline],
    ['sub-border-color', outline > 0 ? '#FF000000' : '#00000000']
  ]
}
