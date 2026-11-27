import type { Channel } from '@/types/playlist'
import type { EPGProgram } from '@/types/epg'
import type { PlaybackRequest } from '@/types/player'
import type { ArchivePlaybackTarget } from '../../../shared/playback'
import { strings } from '@/strings'

/*
 * Watching a programme that has already been on (or started a while ago):
 * an Xtream panel keeps the last days of some channels and serves any stretch
 * of them by its start time and length. The list says which channels
 * (`tvArchive`) and for how many days (`tvArchiveDuration`).
 */

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/** Panels refuse very long stretches; nothing in a guide is longer than this anyway. */
export const MAX_ARCHIVE_MINUTES = 12 * 60
/** A stretch shorter than this is not worth a request (the programme has only just begun). */
const MIN_ARCHIVE_MINUTES = 1

/**
 * What plays `program` of `channel` from the panel's archive, or null when it
 * cannot: the channel has no archive, the programme has not started, or it is
 * older than the panel keeps. A programme still on is played from its start
 * up to now.
 */
export function archivePlayback(channel: Channel, program: EPGProgram, now: number): PlaybackRequest | null {
  if (!channel.tvArchive || typeof channel.streamId !== 'number') return null
  if (!(program.start < now) || !(program.end > program.start)) return null
  const days = channel.tvArchiveDuration && channel.tvArchiveDuration > 0 ? channel.tvArchiveDuration : 0
  if (days <= 0 || program.start < now - days * DAY_MS) return null

  // A programme that has ended is asked for whole (rounded up); one still on
  // only for the whole minutes that have passed, since the rest does not exist yet.
  const ended = program.end <= now
  const length = (ended ? program.end : now) - program.start
  const minutes = Math.min(MAX_ARCHIVE_MINUTES, ended ? Math.ceil(length / MINUTE_MS) : Math.floor(length / MINUTE_MS))
  if (minutes < MIN_ARCHIVE_MINUTES) return null

  const target: ArchivePlaybackTarget = {
    kind: 'archive',
    sourceId: channel.sourceId,
    streamId: channel.streamId,
    start: Math.floor(program.start / 1000),
    duration: minutes
  }
  const cover = channel.logo
  return {
    target,
    channel: {
      id: `${channel.id}_archive_${target.start}`,
      name: strings.epg.archiveTitle(program.title, channel.name),
      streamUrl: '',
      sourceId: channel.sourceId,
      // Seekable and with an end, like a film: the player shows it as one.
      type: 'vod',
      ...(cover ? { logo: cover } : {})
    }
  }
}

/**
 * `start` (epoch seconds) as the panel wants it in an archive address:
 * `YYYY-MM-DD:HH-MM` on the panel's own clock (`timeZone`, an IANA name from
 * its sign-in answer). An unknown zone falls back to this computer's clock.
 */
export function formatArchiveStart(start: number, timeZone: string | null | undefined): string {
  const date = new Date(start * 1000)
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', { ...options, ...(timeZone ? { timeZone } : {}) }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(date)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}:${part('hour')}-${part('minute')}`
}
