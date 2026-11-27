import { describe, expect, it } from 'vitest'
import type { Channel } from '@/types/playlist'
import type { EPGProgram } from '@/types/epg'
import { isLiveTarget, isTrackableTarget, mediaKey, sanitizePlaybackTarget } from '../../../shared/playback'
import { archivePlayback, formatArchiveStart, MAX_ARCHIVE_MINUTES } from './archive'
import { resolveStreamUrl } from './playback'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// 2026-11-27 18:30:00 UTC
const NOW = Date.UTC(2026, 10, 27, 18, 30)

const channel: Channel = {
  id: 'src_live_4',
  name: 'Kanal Dört',
  streamUrl: '',
  streamId: 4,
  sourceId: 'src',
  type: 'live',
  tvArchive: true,
  tvArchiveDuration: 3
}

function program(start: number, end: number): EPGProgram {
  return { channelId: 'ch4', title: 'Ana Haber', start, end }
}

describe('watching a programme from the archive', () => {
  it('offers a programme that has been on, for its whole length', () => {
    const request = archivePlayback(channel, program(NOW - 3 * HOUR, NOW - 2 * HOUR), NOW)
    expect(request?.target).toEqual({ kind: 'archive', sourceId: 'src', streamId: 4, start: (NOW - 3 * HOUR) / 1000, duration: 60 })
    // Shown as a film: it has an end and can be sought in.
    expect(request?.channel).toMatchObject({ type: 'vod', name: 'Ana Haber · Kanal Dört', streamUrl: '' })
  })

  it('offers a programme still on from its start up to now', () => {
    const request = archivePlayback(channel, program(NOW - 20 * 60_000, NOW + 40 * 60_000), NOW)
    expect(request?.target).toMatchObject({ kind: 'archive', duration: 20 })
  })

  it('offers nothing the panel does not keep', () => {
    const ended = program(NOW - 2 * HOUR, NOW - HOUR)
    expect(archivePlayback({ ...channel, tvArchive: false }, ended, NOW)).toBeNull()
    expect(archivePlayback({ ...channel, tvArchiveDuration: 0 }, ended, NOW)).toBeNull()
    expect(archivePlayback({ ...channel, streamId: undefined }, ended, NOW)).toBeNull()
    // Older than the days the panel keeps, not started yet, only just begun.
    expect(archivePlayback(channel, program(NOW - 4 * DAY, NOW - 4 * DAY + HOUR), NOW)).toBeNull()
    expect(archivePlayback(channel, program(NOW + HOUR, NOW + 2 * HOUR), NOW)).toBeNull()
    expect(archivePlayback(channel, program(NOW - 10_000, NOW + HOUR), NOW)).toBeNull()
    // A stretch no panel serves is cut, not refused.
    expect(archivePlayback(channel, program(NOW - 20 * HOUR, NOW - HOUR), NOW)?.target).toMatchObject({ duration: MAX_ARCHIVE_MINUTES })
  })

  it("names the start on the panel's clock, not this computer's", () => {
    const start = Date.UTC(2026, 10, 27, 22, 5) / 1000
    expect(formatArchiveStart(start, 'Europe/Istanbul')).toBe('2026-11-28:01-05')
    expect(formatArchiveStart(start, 'UTC')).toBe('2026-11-27:22-05')
    expect(formatArchiveStart(start, 'America/New_York')).toBe('2026-11-27:17-05')
    // A zone the panel made up: this computer's clock, in the same shape.
    expect(formatArchiveStart(start, 'Mars/Olympus')).toMatch(/^\d{4}-\d{2}-\d{2}:\d{2}-\d{2}$/)
    expect(formatArchiveStart(start, null)).toMatch(/^\d{4}-\d{2}-\d{2}:\d{2}-\d{2}$/)
  })

  it('builds the archive address from the account, never without one', () => {
    const target = archivePlayback(channel, program(Date.UTC(2026, 10, 27, 15, 0), Date.UTC(2026, 10, 27, 16, 0)), NOW)!.target
    const credentials = { url: 'http://panel.example:8080/', username: 'ali veli', password: 'p#ss' }
    expect(resolveStreamUrl(target, { credentials, serverTimeZone: 'Europe/Istanbul' })).toBe(
      'http://panel.example:8080/timeshift/ali%20veli/p%23ss/60/2026-11-27:18-00/4.ts'
    )
    expect(resolveStreamUrl(target, { credentials: null, fallbackUrl: 'http://x.example/a.ts' })).toBeNull()
  })

  it('is neither live nor kept in the watch history', () => {
    const target = archivePlayback(channel, program(NOW - 2 * HOUR, NOW - HOUR), NOW)!.target
    expect(isLiveTarget(target)).toBe(false)
    expect(isTrackableTarget(target)).toBe(false)
    expect(mediaKey(target)).toBe(`archive:src:4@${(NOW - 2 * HOUR) / 1000}`)
    expect(sanitizePlaybackTarget(JSON.parse(JSON.stringify(target)))).toEqual(target)
    expect(sanitizePlaybackTarget({ ...target, duration: 0 })).toBeNull()
  })
})
