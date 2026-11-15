import type { Channel } from '@/types/playlist'

/** Enough of a channel to start playing it again from the dashboard. */
export type WatchProgressChannel = Pick<
  Channel,
  'id' | 'name' | 'streamUrl' | 'sourceId' | 'type'
> &
  Partial<Pick<Channel, 'logo' | 'coverUrl' | 'categoryName'>>

export interface WatchProgressEntry {
  /** Stream URL, not channel id — see `progressKeyFor`. */
  key: string
  channel: WatchProgressChannel
  position: number
  duration: number
  updatedAt: number
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
 * `{host}/movie/{username}/{password}/{id}.{ext}` (xtream-api.ts). The store
 * strips username/password out of every persisted source precisely so they
 * never reach localStorage — the real ones live in the OS-encrypted credential
 * store. Persisting a raw stream URL would put the password straight back into
 * cleartext, so the credential segments are replaced with a placeholder and
 * filled back in at playback time from the live source.
 */
const CREDENTIAL_PLACEHOLDER = '~abi~'
const XTREAM_STREAM_URL = /^(https?:\/\/[^/]+)\/(live|movie|series)\/([^/]+)\/([^/]+)\/(.+)$/
const REDACTED_SEGMENTS = `/${CREDENTIAL_PLACEHOLDER}/${CREDENTIAL_PLACEHOLDER}/`

export function redactStreamUrl(url: string): string {
  const match = url.match(XTREAM_STREAM_URL)
  if (!match) return url

  const [, origin, kind, , , tail] = match
  return `${origin}/${kind}${REDACTED_SEGMENTS}${tail}`
}

export function isRedactedStreamUrl(url: string): boolean {
  return url.includes(REDACTED_SEGMENTS)
}

/**
 * Returns null when a redacted URL cannot be rebuilt — the source was removed or
 * is no longer an Xtream account. Callers drop those entries rather than handing
 * the player a URL that would only fail to authenticate.
 */
export function restoreStreamUrl(
  url: string,
  credentials: { username: string; password: string } | null
): string | null {
  if (!isRedactedStreamUrl(url)) return url
  if (!credentials?.username || !credentials.password) return null

  // Built the same way xtream-api builds it: raw, not percent-encoded.
  return url.replace(REDACTED_SEGMENTS, `/${credentials.username}/${credentials.password}/`)
}

/**
 * Series episodes are handed to the player with `id: ep_${Date.now()}`
 * (SeriesPage.tsx), so a channel id is a different value every single time the
 * same episode is opened and could never match a stored entry. The stream URL is
 * the one identifier that stays put across sessions for both VOD and episodes —
 * redacted, so the key itself never holds a credential either.
 */
export function progressKeyFor(channel: Pick<Channel, 'streamUrl'>): string | null {
  const url = channel.streamUrl?.trim()
  return url ? redactStreamUrl(url) : null
}

/** Live has no meaningful position — only VOD and episodes are tracked. */
export function isTrackableChannel(channel: Pick<Channel, 'type' | 'streamUrl'>): boolean {
  return channel.type !== 'live' && progressKeyFor(channel) !== null
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

export function findProgress(
  entries: WatchProgressEntry[],
  channel: Pick<Channel, 'streamUrl'>
): WatchProgressEntry | null {
  const key = progressKeyFor(channel)
  if (!key) return null
  return entries.find((entry) => entry.key === key) ?? null
}

/**
 * A resume is pending when the stream was (re)started and has not been put back
 * at its saved position yet. Whatever the engine reports in that window is the
 * restart, not the viewer's progress, so it must not pull the entry backwards.
 */
export function wouldRewindPendingResume(
  entries: WatchProgressEntry[],
  channel: Pick<Channel, 'streamUrl'>,
  position: number,
  pendingResumeStreamUrl: string | null
): boolean {
  if (!pendingResumeStreamUrl || pendingResumeStreamUrl !== channel.streamUrl) return false
  const saved = findProgress(entries, channel)
  return saved !== null && position < saved.position
}

/**
 * Newest first, one entry per stream, capped. Callers pass the whole list back
 * so the store stays a plain array — ordering is the recency signal the
 * dashboard row renders directly.
 */
export function upsertProgress(
  entries: WatchProgressEntry[],
  entry: WatchProgressEntry
): WatchProgressEntry[] {
  const withoutKey = entries.filter((existing) => existing.key !== entry.key)
  return [entry, ...withoutKey].slice(0, MAX_ENTRIES)
}

export function removeProgress(entries: WatchProgressEntry[], key: string): WatchProgressEntry[] {
  return entries.filter((entry) => entry.key !== key)
}

export function toProgressChannel(channel: Channel): WatchProgressChannel {
  return {
    id: channel.id,
    name: channel.name,
    streamUrl: redactStreamUrl(channel.streamUrl),
    sourceId: channel.sourceId,
    type: channel.type,
    ...(channel.logo ? { logo: channel.logo } : {}),
    ...(channel.coverUrl ? { coverUrl: channel.coverUrl } : {}),
    ...(channel.categoryName ? { categoryName: channel.categoryName } : {})
  }
}

/**
 * Persisted entries come back from localStorage as unknown data — a shape change
 * or hand-edited payload must not crash the dashboard, so anything that does not
 * look like an entry is dropped.
 */
export function sanitizeProgressEntries(value: unknown): WatchProgressEntry[] {
  if (!Array.isArray(value)) return []

  const entries: WatchProgressEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Partial<WatchProgressEntry>
    const channel = candidate.channel as Partial<WatchProgressChannel> | undefined

    if (typeof candidate.key !== 'string' || !candidate.key) continue
    // A zero/negative duration would render as `NaN%` progress and "NaN dk
    // kaldı", so the guards match what the recorder can actually produce.
    if (typeof candidate.position !== 'number' || !(candidate.position >= 0)) continue
    if (typeof candidate.duration !== 'number' || !(candidate.duration > 0)) continue
    if (!Number.isFinite(candidate.position) || !Number.isFinite(candidate.duration)) continue
    if (!channel || typeof channel.name !== 'string' || typeof channel.streamUrl !== 'string') {
      continue
    }
    // Live is never tracked, so a stored live entry can only be a corrupted or
    // hand-edited payload.
    if (channel.type !== 'vod' && channel.type !== 'series') continue

    entries.push({
      key: candidate.key,
      position: candidate.position,
      duration: candidate.duration,
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
      channel: {
        id: typeof channel.id === 'string' ? channel.id : candidate.key,
        name: channel.name,
        // Older payloads (and any hand-edited one) may still hold a raw URL.
        streamUrl: redactStreamUrl(channel.streamUrl),
        sourceId: typeof channel.sourceId === 'string' ? channel.sourceId : '',
        type: channel.type,
        ...(typeof channel.logo === 'string' ? { logo: channel.logo } : {}),
        ...(typeof channel.coverUrl === 'string' ? { coverUrl: channel.coverUrl } : {}),
        ...(typeof channel.categoryName === 'string'
          ? { categoryName: channel.categoryName }
          : {})
      }
    })

    if (entries.length >= MAX_ENTRIES) break
  }

  return entries
}
