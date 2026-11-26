import { itemAt } from '../../../shared/checked'
import type { Channel, SourceType } from '@/types/playlist'
import type { PendingResume } from '@/types/player'
import {
  episodeTarget,
  isMediaKey,
  isPlayableTarget,
  isTrackableTarget,
  m3uEntryId,
  mediaKey,
  sanitizePlaybackTarget,
  targetFromCatalogItem,
  type PlayableTarget,
  type PlaybackTarget
} from '../../../shared/playback'
import { isHttpUrl } from './playback'

/** Enough of a channel to show it on the dashboard and start it again. */
export type WatchProgressChannel = Pick<
  Channel,
  'id' | 'name' | 'streamUrl' | 'sourceId' | 'type'
> &
  Partial<Pick<Channel, 'logo' | 'coverUrl' | 'categoryName'>>

export interface WatchProgressEntry {
  /**
   * `mediaKey(target)`. Only an entry the migration could not map to a target
   * keeps its old key: the stream URL with the Xtream credentials redacted.
   */
  key: string
  /** Null only for such unmapped legacy entries. */
  target: PlaybackTarget | null
  /**
   * Display data. `streamUrl` is empty for every entry with a target: Xtream
   * URLs are rebuilt from the source's credentials, and an M3U entry's URL
   * (which often holds the account password as well) is looked up in the
   * loaded playlist by the target's `entryId` when it is played. A legacy
   * entry keeps its redacted URL.
   */
  channel: WatchProgressChannel
  position: number
  duration: number
  updatedAt: number
}

/** What the recorder saves progress for: the current playback's target and display channel. */
export interface ProgressSubject {
  target: PlaybackTarget
  channel: Channel
  /** The URL being played; only used to find a legacy entry for the same item. */
  streamUrl?: string | null
}

/** Below this a resume prompt is noise — the viewer barely started. */
export const MIN_TRACKED_SECONDS = 30
/** Past this the title counts as watched and leaves the list. */
export const COMPLETION_RATIO = 0.92
/** Rewind a few seconds so the viewer re-enters with context. */
export const RESUME_BACKSTEP_SECONDS = 5
export const MAX_ENTRIES = 20

/**
 * Xtream stream URLs carry the account credentials in the path:
 * `{host}/movie/{username}/{password}/{id}.{ext}`. History used to be keyed by
 * that URL with the two segments replaced by a placeholder; those keys are only
 * still read, to migrate and to match entries that could not be migrated.
 */
const CREDENTIAL_PLACEHOLDER = '~abi~'
const XTREAM_STREAM_URL = /^(https?:\/\/[^/]+)\/(live|movie|series)\/([^/]+)\/([^/]+)\/(.+)$/
const REDACTED_SEGMENTS = `/${CREDENTIAL_PLACEHOLDER}/${CREDENTIAL_PLACEHOLDER}/`
const XTREAM_TAIL = /^(\d+)\.([A-Za-z0-9]{1,8})(?:[?#].*)?$/

export function redactStreamUrl(url: string): string {
  const match = url.match(XTREAM_STREAM_URL)
  if (!match) return url

  const [, origin, kind, , , tail] = match
  return `${origin}/${kind}${REDACTED_SEGMENTS}${tail}`
}

export function isRedactedStreamUrl(url: string): boolean {
  return url.includes(REDACTED_SEGMENTS)
}

/** The key a legacy (URL-keyed) entry for this URL would have. */
export function legacyProgressKeyFor(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  return trimmed ? redactStreamUrl(trimmed) : null
}

export function isCompleted(position: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false
  return position / duration >= COMPLETION_RATIO
}

/**
 * A position is worth storing once the viewer is past the opening minute-ish and
 * has not reached the end. Non-finite duration (live-ish or still loading) is
 * never stored: without it the dashboard cannot draw progress.
 */
export function shouldStoreProgress(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return false
  if (duration <= 0 || position < MIN_TRACKED_SECONDS) return false
  return !isCompleted(position, duration)
}

export function resumePositionFor(entry: WatchProgressEntry): number {
  return Math.max(0, entry.position - RESUME_BACKSTEP_SECONDS)
}

/**
 * The entry for a media key; failing that, an unmigrated legacy entry stored
 * under `legacyKey` (so an item the migration could not map still resumes
 * when it is played again, and is re-keyed by the next save).
 */
export function findProgress(
  entries: WatchProgressEntry[],
  key: string,
  legacyKey?: string | null
): WatchProgressEntry | null {
  const exact = entries.find((entry) => entry.key === key)
  if (exact) return exact
  if (!legacyKey) return null
  return entries.find((entry) => entry.target === null && entry.key === legacyKey) ?? null
}

/**
 * A resume is pending when the item was (re)started and has not been put back
 * at its saved position yet. Whatever the engine reports in that window is the
 * restart, not the viewer's progress, so it must not pull the entry backwards.
 */
export function wouldRewindPendingResume(
  entries: WatchProgressEntry[],
  key: string,
  position: number,
  pendingResume: Pick<PendingResume, 'mediaKey'> | null,
  legacyKey?: string | null
): boolean {
  if (!pendingResume || pendingResume.mediaKey !== key) return false
  const saved = findProgress(entries, key, legacyKey)
  return saved !== null && position < saved.position
}

/**
 * Newest first, one entry per key, capped. Callers pass the whole list back
 * so the store stays a plain array — ordering is the recency signal the
 * dashboard row renders directly.
 */
export function upsertProgress(
  entries: WatchProgressEntry[],
  entry: WatchProgressEntry,
  replacesKey?: string | null
): WatchProgressEntry[] {
  const rest = entries.filter(
    (existing) =>
      existing.key !== entry.key &&
      !(replacesKey && existing.target === null && existing.key === replacesKey)
  )
  return [entry, ...rest].slice(0, MAX_ENTRIES)
}

export function removeProgress(entries: WatchProgressEntry[], key: string): WatchProgressEntry[] {
  return entries.filter((entry) => entry.key !== key)
}

/**
 * Display data to store. No URL: an Xtream URL holds the account password, and
 * so does the entry URL of most M3U playlists (they are generated by the same
 * panels). The target identifies the item; the URL is resolved when played.
 */
export function toProgressChannel(channel: Channel, _target: PlaybackTarget): WatchProgressChannel {
  return {
    id: channel.id,
    name: channel.name,
    streamUrl: '',
    sourceId: channel.sourceId,
    type: channel.type,
    ...(channel.logo ? { logo: channel.logo } : {}),
    ...(channel.coverUrl ? { coverUrl: channel.coverUrl } : {}),
    ...(channel.categoryName ? { categoryName: channel.categoryName } : {})
  }
}

export type ProgressUpdate =
  | { kind: 'none' }
  | { kind: 'remove'; keys: string[] }
  | { kind: 'upsert'; entry: WatchProgressEntry; replacesKey: string | null }

/** What saving `position` for `subject` should do to the list. */
export function planProgressUpdate(
  subject: ProgressSubject,
  position: number,
  duration: number,
  now = Date.now()
): ProgressUpdate {
  const { target } = subject
  if (!isTrackableTarget(target)) return { kind: 'none' }
  const key = mediaKey(target)
  const legacyKey = legacyProgressKeyFor(subject.streamUrl ?? subject.channel.streamUrl)

  if (!shouldStoreProgress(position, duration)) {
    // Reaching the end is what retires an entry; anything else (a few
    // seconds in, duration not known yet) leaves the stored position alone.
    if (isCompleted(position, duration)) {
      return { kind: 'remove', keys: legacyKey ? [key, legacyKey] : [key] }
    }
    return { kind: 'none' }
  }

  return {
    kind: 'upsert',
    entry: {
      key,
      target,
      channel: toProgressChannel(subject.channel, target),
      position,
      duration,
      updatedAt: now
    },
    replacesKey: legacyKey
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Persisted entries come back from localStorage as unknown data — a shape change
 * or hand-edited payload must not crash the dashboard, so anything that does not
 * look like an entry is dropped. An entry with a valid target is keyed by it.
 */
export function sanitizeProgressEntries(value: unknown): WatchProgressEntry[] {
  if (!Array.isArray(value)) return []

  const entries: WatchProgressEntry[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const channel = isRecord(raw.channel) ? raw.channel : null

    if (typeof raw.key !== 'string' || !raw.key) continue
    // A zero/negative duration would render as `NaN%` progress and "NaN dk
    // kaldı", so the guards match what the recorder can actually produce.
    if (typeof raw.position !== 'number' || !(raw.position >= 0)) continue
    if (typeof raw.duration !== 'number' || !(raw.duration > 0)) continue
    if (!Number.isFinite(raw.position) || !Number.isFinite(raw.duration)) continue
    if (!channel || typeof channel.name !== 'string') continue
    // Live is never tracked, so a stored live entry can only be a corrupted or
    // hand-edited payload.
    if (channel.type !== 'vod' && channel.type !== 'series') continue

    const target = sanitizePlaybackTarget(raw.target)
    if (target && !isTrackableTarget(target)) continue
    const key = target ? mediaKey(target) : raw.key
    if (seen.has(key)) continue
    seen.add(key)

    const storedUrl = typeof channel.streamUrl === 'string' ? channel.streamUrl : ''
    const streamUrl = target
      ? ''
      : // Older payloads (and any hand-edited one) may still hold a raw URL.
        redactStreamUrl(storedUrl || raw.key)

    entries.push({
      key,
      target,
      position: raw.position,
      duration: raw.duration,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      channel: {
        id: typeof channel.id === 'string' ? channel.id : key,
        name: channel.name,
        streamUrl,
        sourceId: typeof channel.sourceId === 'string' ? channel.sourceId : target?.sourceId ?? '',
        type: channel.type,
        ...(typeof channel.logo === 'string' ? { logo: channel.logo } : {}),
        ...(typeof channel.coverUrl === 'string' ? { coverUrl: channel.coverUrl } : {}),
        ...(typeof channel.categoryName === 'string' ? { categoryName: channel.categoryName } : {})
      }
    })

    if (entries.length >= MAX_ENTRIES) break
  }

  return entries
}

/**
 * The target an entry of the URL-keyed history stands for, when that can still
 * be told. Xtream entries carry the kind, stream id and extension in the
 * (redacted) path. An M3U entry is identified by its URL, so it maps only if
 * the stored URL was not redacted; a redacted one has lost the credentials the
 * real URL contains.
 */
export function legacyEntryTarget(
  storedUrl: string,
  sourceId: string,
  sourceType: SourceType | null,
  channelType: 'vod' | 'series'
): { target: PlayableTarget; entryUrl: string } | null {
  if (sourceType === 'xtream') {
    const match = storedUrl.match(XTREAM_STREAM_URL)
    if (!match) return null
    const kind = match[2]
    const parts = itemAt(match, 5).match(XTREAM_TAIL)
    if (!parts) return null
    const streamId = Number(itemAt(parts, 1))
    if (!Number.isSafeInteger(streamId)) return null
    const containerExtension = itemAt(parts, 2).toLowerCase()
    if (kind === 'movie') {
      return { target: { kind: 'movie', sourceId, streamId, containerExtension }, entryUrl: '' }
    }
    if (kind === 'series') {
      return { target: episodeTarget({ sourceId, episodeId: streamId, containerExtension }), entryUrl: '' }
    }
    return null
  }

  if (sourceType === 'm3u_url' || sourceType === 'm3u_file') {
    if (!isHttpUrl(storedUrl) || isRedactedStreamUrl(storedUrl)) return null
    const target: PlayableTarget = {
      kind: 'm3u',
      sourceId,
      entryId: m3uEntryId(storedUrl),
      mediaType: channelType
    }
    return { target, entryUrl: storedUrl.trim() }
  }

  return null
}

/**
 * Migration of the persisted history from URL keys to media keys. Pure and
 * idempotent: entries that already have a target, and anything it does not
 * recognise, pass through unchanged, so it can run again on its own output.
 * Entries that cannot be mapped are kept as they are (see `findProgress`).
 */
export function migrateProgressEntriesToMediaKeys(
  entries: unknown,
  sources: unknown
): unknown {
  if (!Array.isArray(entries)) return entries
  const sourceTypes = new Map<string, SourceType>()
  if (Array.isArray(sources)) {
    for (const source of sources) {
      if (isRecord(source) && typeof source.id === 'string' && typeof source.type === 'string') {
        sourceTypes.set(source.id, source.type as SourceType)
      }
    }
  }

  return entries.map((raw) => {
    if (!isRecord(raw) || raw.target !== undefined) return raw
    if (typeof raw.key !== 'string' || isMediaKey(raw.key)) return raw
    const channel = isRecord(raw.channel) ? raw.channel : null
    if (!channel || (channel.type !== 'vod' && channel.type !== 'series')) return raw
    const sourceId = typeof channel.sourceId === 'string' ? channel.sourceId : ''
    const storedUrl = typeof channel.streamUrl === 'string' && channel.streamUrl ? channel.streamUrl : raw.key

    const mapped = legacyEntryTarget(storedUrl, sourceId, sourceTypes.get(sourceId) ?? null, channel.type)
    if (!mapped) return raw
    return {
      ...raw,
      key: mediaKey(mapped.target),
      target: mapped.target,
      channel: { ...channel, streamUrl: mapped.entryUrl }
    }
  })
}

/**
 * Migration of persisted history (persist v3): entries with a target lose the
 * M3U entry URL they used to store, and legacy entries that still hold an
 * unredacted URL are dropped. Those could not be mapped by the v1 migration,
 * so nothing can play them, and the URL may carry a password. Pure and
 * idempotent; anything it does not recognise passes through.
 */
export function stripStoredEntryUrls(entries: unknown): unknown {
  if (!Array.isArray(entries)) return entries
  const kept: unknown[] = []
  for (const raw of entries) {
    if (!isRecord(raw)) {
      kept.push(raw)
      continue
    }
    const channel = isRecord(raw.channel) ? raw.channel : null
    if (isRecord(raw.target)) {
      kept.push(channel && channel.streamUrl ? { ...raw, channel: { ...channel, streamUrl: '' } } : raw)
      continue
    }
    const holdsRawUrl = (value: unknown) =>
      typeof value === 'string' && isHttpUrl(value) && !isRedactedStreamUrl(value)
    if (holdsRawUrl(raw.key) || holdsRawUrl(channel?.streamUrl)) continue
    kept.push(raw)
  }
  return kept
}

/** One card of the "Devam Et" row and what clicking it plays. */
export interface ContinueWatchingItem {
  entry: WatchProgressEntry
  target: PlayableTarget
  /**
   * Display data. For an M3U entry `streamUrl` is empty: the URL is found in
   * the loaded playlist by `target.entryId` when the card is played
   * (`findM3uEntry` in services/playback).
   */
  channel: Channel
}

/**
 * The route state that opens the series of an episode on /series, on the
 * season the episode is in (the series page reads `restoreSelectedSeries`).
 * Null for anything that is not an episode of a known series: a film, or an
 * episode from the history of a version that did not record its series.
 */
export function seriesRouteStateOf(
  item: Pick<ContinueWatchingItem, 'target'>
): { restoreSelectedSeries: { seriesId: number; sourceId: string; seasonNumber?: number } } | null {
  const { target } = item
  if (target.kind !== 'episode' || target.seriesId === null) return null
  return {
    restoreSelectedSeries: {
      seriesId: target.seriesId,
      sourceId: target.sourceId,
      ...(target.season !== null ? { seasonNumber: target.season } : {})
    }
  }
}

/**
 * The playable part of the history, newest first. An Xtream item needs its
 * source's credentials (the URL is rebuilt from them); an M3U item needs its
 * source to still exist, its playlist may still be loading. A legacy entry is
 * shown when the catalog still has the item it was keyed by.
 */
export function selectContinueWatching(
  entries: WatchProgressEntry[],
  options: {
    hasCredentials: (sourceId: string) => boolean
    /** Defaults to every source. */
    hasSource?: (sourceId: string) => boolean
    findLegacyChannel?: (entry: WatchProgressEntry) => Channel | null
    limit: number
  }
): ContinueWatchingItem[] {
  const items: ContinueWatchingItem[] = []
  for (const entry of entries) {
    if (items.length >= options.limit) break

    if (!entry.target) {
      const channel = options.findLegacyChannel?.(entry) ?? null
      const target = channel ? targetFromCatalogItem(channel) : null
      if (channel && target && isTrackableTarget(target)) items.push({ entry, target, channel })
      continue
    }

    if (!isPlayableTarget(entry.target)) continue
    if (entry.target.kind === 'm3u') {
      if (options.hasSource && !options.hasSource(entry.target.sourceId)) continue
    } else if (!options.hasCredentials(entry.target.sourceId)) {
      continue
    }
    items.push({ entry, target: entry.target, channel: { ...entry.channel } })
  }
  return items
}

/**
 * Index for `findLegacyChannel`: catalog items of the given sources by the
 * legacy key their URL would have had. Built only while legacy entries exist.
 */
export function indexChannelsByLegacyKey(
  channels: Channel[],
  sourceIds: ReadonlySet<string>
): Map<string, Channel> {
  const index = new Map<string, Channel>()
  if (sourceIds.size === 0) return index
  for (const channel of channels) {
    if (!sourceIds.has(channel.sourceId) || channel.type === 'live') continue
    const key = legacyProgressKeyFor(channel.streamUrl)
    if (key && !index.has(`${channel.sourceId}\n${key}`)) index.set(`${channel.sourceId}\n${key}`, channel)
  }
  return index
}

export function legacyIndexKey(entry: WatchProgressEntry): string {
  return `${entry.channel.sourceId}\n${entry.key}`
}
