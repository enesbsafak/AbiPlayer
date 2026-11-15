import type { Channel } from '@/types/playlist'
import type { XtreamAuthResponse, XtreamCredentials, XtreamLiveFormat } from '@/types/xtream'
import { xtreamApi } from './xtream-api'
import { getAllowedLiveFormats, pickLiveFormat } from './xtream-normalize'
import {
  isPlayableTarget,
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
