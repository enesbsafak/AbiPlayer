import { useStore } from '@/store'
import { findCurrentProgram, normalizeEpgChannelKey } from '@/services/epg-service'
import type { EPGData, EPGProgram } from '@/types/epg'
import type { Channel } from '@/types/playlist'
import { LOCALE } from '@/strings'

/** What the guide says about one channel: on air now and next. */
export interface ChannelGuide {
  now: EPGProgram | null
  next: EPGProgram | null
}

/**
 * The guide of `sourceId` when it is in memory, else null. The Canlı TV
 * screen only reads it: the Yayın Akışı screen is what loads a guide, and a
 * channel row simply shows less without one.
 */
export function useSourceGuide(sourceId: string | null): EPGData | null {
  return useStore((s) => (sourceId && s.epgSourceId === sourceId ? s.epgData : null))
}

export function guideFor(guide: EPGData | null, channel: Channel, now: number): ChannelGuide | null {
  if (!guide) return null
  const key = normalizeEpgChannelKey(channel.epgChannelId)
  const programs = key ? guide.programs[key] : undefined
  if (!programs || programs.length === 0) return null
  const current = findCurrentProgram(programs, now)
  const next = programs.find((program) => program.start > now) ?? null
  if (!current && !next) return null
  return { now: current, next }
}

/** How far into `program` `now` is, 0–100. */
export function programmeProgress(program: EPGProgram, now: number): number {
  const length = program.end - program.start
  if (length <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(((now - program.start) / length) * 100)))
}

/** The first letter or digit of a channel name, past a country prefix ("FR: Movies" → "M"). */
export function channelInitial(name: string): string {
  const withoutPrefix = name.replace(/^[A-Z]{2,3}\s*[:|]\s*/u, '')
  const match = withoutPrefix.match(/[\p{L}\p{N}]/u) ?? name.match(/[\p{L}\p{N}]/u)
  return match ? match[0].toLocaleUpperCase(LOCALE) : '·'
}

/** Whole minutes left of `program` at `now`. */
export function minutesLeft(program: EPGProgram, now: number): number {
  return Math.max(0, Math.round((program.end - now) / 60_000))
}
