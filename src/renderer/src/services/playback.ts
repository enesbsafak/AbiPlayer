import type { Channel } from '@/types/playlist'
import type { XtreamAuthResponse, XtreamCredentials, XtreamLiveFormat } from '@/types/xtream'
import { xtreamApi } from './xtream-api'
import { getAllowedLiveFormats, pickLiveFormat } from './xtream-normalize'
import {
  isPlayableTarget,
  m3uEntryId,
  targetFromCatalogItem,
  type PlaybackTarget
} from '../../../shared/playback'

export function isHttpUrl(value: string | null | undefined): value is string {
  const url = value?.trim()
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** The target a catalog item plays (see `targetFromCatalogItem`). */
export function targetFromChannel(channel: Channel): PlaybackTarget | null {
  return targetFromCatalogItem(channel)
}

/**
 * Whether clicking the item starts playback. Xtream items only need their
 * provider id (the URL is built from the source's credentials when played); an
 * M3U entry needs its own URL. A series container never plays.
 */
export function isPlayableChannel(channel: Channel): boolean {
  const target = targetFromChannel(channel)
  if (!target || !isPlayableTarget(target)) return false
  if (target.kind === 'm3u') return isHttpUrl(channel.streamUrl)
  return true
}

export const DEFAULT_LIVE_FORMAT: XtreamLiveFormat = 'm3u8'

export interface StreamUrlContext {
  /** Credentials of the target's own source; null when unknown or not Xtream. */
  credentials: XtreamCredentials | null
  /** Live formats the account allows (`getAllowedLiveFormats`) and the one wanted. */
  liveFormat?: { allowed: readonly XtreamLiveFormat[]; preferred: XtreamLiveFormat }
  /** An M3U entry's own URL, from the catalog or the history entry. */
  entryUrl?: string | null
  /**
   * The URL the catalog item still carries (`Channel.streamUrl`). Used only
   * when nothing better can be derived; goes away with that field.
   */
  fallbackUrl?: string | null
}

/**
 * The single place a target becomes a URL. Call it only at the edges: when the
 * URL is handed to mpv, to the `<video>` element or hls.js, or to the subtitle
 * probe and extraction. Returns null when the target cannot be played with what
 * is known (no credentials and no stored URL, or a series container).
 */
export function resolveStreamUrl(target: PlaybackTarget, context: StreamUrlContext): string | null {
  const fallback = isHttpUrl(context.fallbackUrl) ? context.fallbackUrl.trim() : null

  switch (target.kind) {
    case 'series':
      return null
    case 'm3u':
      return isHttpUrl(context.entryUrl) ? context.entryUrl.trim() : fallback
    case 'live': {
      if (!context.credentials) return fallback
      const allowed = context.liveFormat?.allowed ?? getAllowedLiveFormats(null)
      const preferred = context.liveFormat?.preferred ?? DEFAULT_LIVE_FORMAT
      return xtreamApi.buildLiveUrl(context.credentials, target.streamId, pickLiveFormat(allowed, preferred))
    }
    case 'movie':
      if (!context.credentials) return fallback
      return xtreamApi.buildVodUrl(context.credentials, target.streamId, target.containerExtension)
    case 'episode':
      if (!context.credentials) return fallback
      return xtreamApi.buildSeriesUrl(context.credentials, target.streamId, target.containerExtension)
  }
}

/** The catalog reads `findM3uEntry` needs (the catalog store has them). */
export interface M3uEntryLookup {
  getItem(id: string): Channel | undefined
  getItems(sourceId: string, type: Channel['type']): readonly Channel[]
}

const MEDIA_TYPES: readonly Channel['type'][] = ['live', 'vod', 'series']

/**
 * The loaded playlist entry an M3U target stands for, or null when its
 * playlist is not loaded or no longer lists it. Stored history and favourites
 * keep only the entry id (a hash of the URL), never the URL itself, so the URL
 * comes from here when they are played. `preferredId` is the catalog id the
 * entry had when it was stored: tried first, then the source's lists.
 */
export function findM3uEntry(
  target: Extract<PlaybackTarget, { kind: 'm3u' }>,
  lookup: M3uEntryLookup,
  preferredId?: string
): Channel | null {
  const matches = (item: Channel | undefined): item is Channel =>
    !!item &&
    item.sourceId === target.sourceId &&
    isHttpUrl(item.streamUrl) &&
    m3uEntryId(item.streamUrl) === target.entryId
  if (preferredId) {
    const item = lookup.getItem(preferredId)
    if (matches(item)) return item
  }
  const types = [target.mediaType, ...MEDIA_TYPES.filter((type) => type !== target.mediaType)]
  for (const type of types) {
    const found = lookup.getItems(target.sourceId, type).find(matches)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// Live format (plan F2-04): which of the account's live formats an engine gets.

/** The "Canlı yayın biçimi" setting. */
export type LiveFormatSetting = 'auto' | XtreamLiveFormat

export type PlaybackEngineKind = 'mpv' | 'html5'

/**
 * What "Otomatik" means for mpv. Measured on the synthetic provider
 * (docs/olcumler/2026-11-15-oynatma-acilisi.md): MPEG-TS gave mpv no faster
 * start than HLS, so automatic keeps HLS.
 */
export const AUTO_MPV_LIVE_FORMAT: XtreamLiveFormat = 'm3u8'

/**
 * The live format to request for an Xtream live channel. The HTML5 engine
 * plays live only through hls.js, so it always asks for HLS; mpv follows the
 * setting. A format the account does not allow is never chosen.
 */
export function decideLiveFormat(
  engine: PlaybackEngineKind,
  setting: LiveFormatSetting,
  allowed: readonly XtreamLiveFormat[]
): XtreamLiveFormat {
  if (engine === 'html5') return pickLiveFormat(allowed, 'm3u8')
  return pickLiveFormat(allowed, setting === 'auto' ? AUTO_MPV_LIVE_FORMAT : setting)
}

/**
 * The format to try once when a channel did not open in `failed`, or null.
 * Only an explicit choice falls back: "Otomatik" keeps today's behaviour
 * (HLS, and the reconnect policy when it fails), and the HTML5 engine has no
 * other format to go to.
 */
export function liveFormatFallback(
  engine: PlaybackEngineKind,
  setting: LiveFormatSetting,
  allowed: readonly XtreamLiveFormat[],
  failed: XtreamLiveFormat
): XtreamLiveFormat | null {
  if (engine !== 'mpv' || setting === 'auto') return null
  const other: XtreamLiveFormat = failed === 'ts' ? 'm3u8' : 'ts'
  return allowed.includes(other) ? other : null
}

export function liveFormatLabel(format: XtreamLiveFormat): string {
  return format === 'ts' ? 'MPEG-TS' : 'HLS'
}

/**
 * The URL an engine plays for a playback. Only an Xtream live channel depends
 * on the engine (its format); everything else plays the URL resolved when the
 * playback started. `format` is null for those.
 */
export function resolveEngineStreamUrl(
  playback: { target: PlaybackTarget; streamUrl: string },
  engine: PlaybackEngineKind,
  setting: LiveFormatSetting,
  state: PlaybackSourceState,
  formatOverride?: XtreamLiveFormat
): { url: string; format: XtreamLiveFormat | null; allowed: readonly XtreamLiveFormat[] } {
  const { target } = playback
  const credentials = target.kind === 'live' ? (state.getXtreamCredentials?.(target.sourceId) ?? null) : null
  if (target.kind !== 'live' || !credentials) return { url: playback.streamUrl, format: null, allowed: [] }
  const allowed = getAllowedLiveFormats(state.xtreamAuth?.[target.sourceId])
  const format =
    formatOverride && allowed.includes(formatOverride) ? formatOverride : decideLiveFormat(engine, setting, allowed)
  const url = resolveStreamUrl(target, { credentials, liveFormat: { allowed, preferred: format } })
  return url ? { url, format, allowed } : { url: playback.streamUrl, format: null, allowed: [] }
}

/** The parts of the store a URL is resolved from. Optional so slices can be tested alone. */
export interface PlaybackSourceState {
  getXtreamCredentials?: (sourceId: string) => XtreamCredentials | null
  xtreamAuth?: Record<string, XtreamAuthResponse>
}

/** `StreamUrlContext` for a target, from the store's sources and account info. */
export function streamUrlContextFor(
  target: PlaybackTarget,
  state: PlaybackSourceState,
  urls: { entryUrl?: string | null; fallbackUrl?: string | null } = {},
  preferredLiveFormat: XtreamLiveFormat = DEFAULT_LIVE_FORMAT
): StreamUrlContext {
  return {
    credentials: state.getXtreamCredentials?.(target.sourceId) ?? null,
    liveFormat: {
      allowed: getAllowedLiveFormats(state.xtreamAuth?.[target.sourceId]),
      preferred: preferredLiveFormat
    },
    entryUrl: urls.entryUrl,
    fallbackUrl: urls.fallbackUrl
  }
}
