/**
 * What is to be played, independent of how it is reached.
 *
 * A target never holds a URL or a credential: the URL is derived from it at the
 * edges (see `resolveStreamUrl` in the renderer's services/playback.ts). That is
 * what lets watch history and resume compare "the same stream" without a URL,
 * and what lets the catalog stop carrying stream URLs that embed passwords.
 */

/** Xtream live channel. */
export interface LivePlaybackTarget {
  kind: 'live'
  sourceId: string
  streamId: number
}

/** Xtream film (VOD). */
export interface MoviePlaybackTarget {
  kind: 'movie'
  sourceId: string
  streamId: number
  containerExtension: string
}

/** One Xtream series episode; `streamId` is the episode id the URL is built from. */
export interface EpisodePlaybackTarget {
  kind: 'episode'
  sourceId: string
  streamId: number
  containerExtension: string
  /** Unknown for entries migrated from the URL-keyed history. */
  seriesId: number | null
  season: number | null
  episode: number | null
}

/** An Xtream series as a whole. Not playable; it opens its detail page. */
export interface SeriesPlaybackTarget {
  kind: 'series'
  sourceId: string
  seriesId: number
}

export type M3uMediaType = 'live' | 'vod' | 'series'

/**
 * One M3U playlist entry. The entry's URL is its identity, but it is kept out of
 * the target: `entryId` is a stable hash of it, and the URL itself comes from
 * the catalog (or the history entry) when the stream is opened.
 */
export interface M3uPlaybackTarget {
  kind: 'm3u'
  sourceId: string
  entryId: string
  mediaType: M3uMediaType
}

/** The content types of an add-on's catalogue the app shows (films and series). */
export type AddonContentType = 'movie' | 'series'

/**
 * A film or one series episode from an add-on (Stremio add-on protocol).
 * `sourceId` is the catalogue add-on the item came from; the stream itself may
 * come from any installed add-on. `videoId` is what the stream request takes:
 * the meta id for a film, the episode's video id for a series. No URL: the
 * chosen stream's URL lives only in the session's stream registry.
 */
export interface AddonPlaybackTarget {
  kind: 'addon'
  sourceId: string
  contentType: AddonContentType
  metaId: string
  videoId: string
}

export type PlaybackTarget =
  | LivePlaybackTarget
  | MoviePlaybackTarget
  | EpisodePlaybackTarget
  | SeriesPlaybackTarget
  | M3uPlaybackTarget
  | AddonPlaybackTarget

export type PlayableTarget = Exclude<PlaybackTarget, SeriesPlaybackTarget>

export const DEFAULT_CONTAINER_EXTENSION = 'mp4'

export function isPlayableTarget(target: PlaybackTarget): target is PlayableTarget {
  return target.kind !== 'series'
}

/** Live has no position: no resume, no watch history. */
export function isLiveTarget(target: PlaybackTarget): boolean {
  return target.kind === 'live' || (target.kind === 'm3u' && target.mediaType === 'live')
}

/** Films and episodes (Xtream, M3U or add-on) get watch progress and resume. */
export function isTrackableTarget(target: PlaybackTarget): target is PlayableTarget {
  return isPlayableTarget(target) && !isLiveTarget(target)
}

const MEDIA_KEY_PATTERN = /^(live|movie|episode|series|m3u|addon):[^:]*:[^:]+$/

/**
 * Stable identity for history and resume: `<kind>:<sourceId>:<item id>`.
 *
 * The source is part of the key, so two accounts on the same host never share
 * an entry. The container extension is not: the same film stays the same film
 * if the panel starts serving it as mkv instead of mp4. No URL, no credential.
 * An add-on's video id is encoded like the source id (it commonly holds ':').
 */
export function mediaKey(target: PlaybackTarget): string {
  const source = encodeURIComponent(target.sourceId)
  switch (target.kind) {
    case 'live':
    case 'movie':
    case 'episode':
      return `${target.kind}:${source}:${target.streamId}`
    case 'series':
      return `series:${source}:${target.seriesId}`
    case 'm3u':
      return `m3u:${source}:${target.entryId}`
    case 'addon':
      return `addon:${source}:${encodeURIComponent(target.videoId)}`
  }
}

export function isMediaKey(value: string): boolean {
  return MEDIA_KEY_PATTERN.test(value)
}

/**
 * Stable 53-bit hash (cyrb53) as 14 hex digits. 32 bits are not enough here: a
 * 200 000-entry playlist would be expected to collide a few times.
 */
export function stableHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}

/** The `entryId` of an M3U entry: a hash of its URL, so the key never holds it. */
export function m3uEntryId(url: string): string {
  return stableHash(url.trim())
}

/**
 * The fields of a catalog item (the renderer's `Channel`) that identify what it
 * plays. Structural, so this module does not depend on renderer types.
 */
export interface CatalogItemIdentity {
  sourceId: string
  type: 'live' | 'vod' | 'series'
  streamId?: number
  seriesId?: number
  containerExtension?: string
  streamUrl?: string
  /** The meta id of an add-on catalogue item. */
  addonMetaId?: string
  /** An add-on film's stream id when it is not its meta id (the built-in TMDB catalogue's IMDb id). */
  addonVideoId?: string
}

function isUsableId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function normalizeExtension(value: string | undefined): string {
  const trimmed = value?.trim().replace(/^\.+/, '').toLowerCase()
  return trimmed && /^[a-z0-9]{1,8}$/.test(trimmed) ? trimmed : DEFAULT_CONTAINER_EXTENSION
}

/**
 * The target a catalog item plays. Add-on items are recognised by their meta
 * id: a film plays its meta id (or its `addonVideoId`, when its catalogue
 * names streams by another id); an add-on series has no target of its own (its
 * episodes come from its detail page). Xtream items are recognised by their
 * provider id (`streamId` for live and films, `seriesId` for a series); an item
 * without one is an M3U entry identified by its URL. Null when the item carries
 * none of these.
 */
export function targetFromCatalogItem(item: CatalogItemIdentity): PlaybackTarget | null {
  if (item.addonMetaId !== undefined) {
    if (item.type !== 'vod' || !isAddonId(item.addonMetaId)) return null
    return addonTarget({
      sourceId: item.sourceId,
      contentType: 'movie',
      metaId: item.addonMetaId,
      ...(isAddonId(item.addonVideoId) ? { videoId: item.addonVideoId } : {})
    })
  }
  if (isUsableId(item.streamId)) {
    if (item.type === 'live') return { kind: 'live', sourceId: item.sourceId, streamId: item.streamId }
    if (item.type === 'vod') {
      return {
        kind: 'movie',
        sourceId: item.sourceId,
        streamId: item.streamId,
        containerExtension: normalizeExtension(item.containerExtension)
      }
    }
  }
  if (item.type === 'series' && isUsableId(item.seriesId)) {
    return { kind: 'series', sourceId: item.sourceId, seriesId: item.seriesId }
  }
  const url = item.streamUrl?.trim()
  if (url) {
    return { kind: 'm3u', sourceId: item.sourceId, entryId: m3uEntryId(url), mediaType: item.type }
  }
  return null
}

export interface EpisodeIdentity {
  sourceId: string
  /** The episode's own id (Xtream `episodes[].id`). */
  episodeId: number
  containerExtension?: string
  seriesId?: number | null
  season?: number | null
  episode?: number | null
}

export function episodeTarget(input: EpisodeIdentity): EpisodePlaybackTarget {
  const optionalNumber = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    kind: 'episode',
    sourceId: input.sourceId,
    streamId: input.episodeId,
    containerExtension: normalizeExtension(input.containerExtension),
    seriesId: optionalNumber(input.seriesId),
    season: optionalNumber(input.season),
    episode: optionalNumber(input.episode)
  }
}

/** Longest add-on meta or video id accepted; real ones are short (`tt1234567:1:2`). */
export const MAX_ADDON_ID_LENGTH = 512

/** A non-empty add-on id without control characters and of sane length. */
export function isAddonId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_ADDON_ID_LENGTH &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

export interface AddonTargetInput {
  sourceId: string
  contentType: AddonContentType
  metaId: string
  /** Defaults to the meta id (a film). */
  videoId?: string
}

export function addonTarget(input: AddonTargetInput): AddonPlaybackTarget {
  return {
    kind: 'addon',
    sourceId: input.sourceId,
    contentType: input.contentType,
    metaId: input.metaId,
    videoId: input.videoId ?? input.metaId
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalId(value: unknown): number | null {
  return isUsableId(value) ? value : null
}

/**
 * A target read back from storage (unknown data). Anything that does not look
 * like one of the shapes above is rejected rather than half-trusted.
 */
export function sanitizePlaybackTarget(raw: unknown): PlaybackTarget | null {
  if (!isRecord(raw)) return null
  const sourceId = raw.sourceId
  if (typeof sourceId !== 'string') return null

  switch (raw.kind) {
    case 'live':
      return isUsableId(raw.streamId) ? { kind: 'live', sourceId, streamId: raw.streamId } : null
    case 'movie':
      if (!isUsableId(raw.streamId)) return null
      return {
        kind: 'movie',
        sourceId,
        streamId: raw.streamId,
        containerExtension: normalizeExtension(
          typeof raw.containerExtension === 'string' ? raw.containerExtension : undefined
        )
      }
    case 'episode':
      if (!isUsableId(raw.streamId)) return null
      return {
        kind: 'episode',
        sourceId,
        streamId: raw.streamId,
        containerExtension: normalizeExtension(
          typeof raw.containerExtension === 'string' ? raw.containerExtension : undefined
        ),
        seriesId: optionalId(raw.seriesId),
        season: optionalId(raw.season),
        episode: optionalId(raw.episode)
      }
    case 'series':
      return isUsableId(raw.seriesId) ? { kind: 'series', sourceId, seriesId: raw.seriesId } : null
    case 'm3u': {
      const mediaType = raw.mediaType
      if (typeof raw.entryId !== 'string' || !/^[0-9a-f]{6,32}$/.test(raw.entryId)) return null
      if (mediaType !== 'live' && mediaType !== 'vod' && mediaType !== 'series') return null
      return { kind: 'm3u', sourceId, entryId: raw.entryId, mediaType }
    }
    case 'addon': {
      const contentType = raw.contentType
      if (contentType !== 'movie' && contentType !== 'series') return null
      if (!isAddonId(raw.metaId) || !isAddonId(raw.videoId)) return null
      return addonTarget({ sourceId, contentType, metaId: raw.metaId, videoId: raw.videoId })
    }
    default:
      return null
  }
}
