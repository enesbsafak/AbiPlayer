import { useMemo } from 'react'
import { useStore } from '@/store'
import{ findCurrentProgram, getUpcomingPrograms, normalizeEpgChannelKey } from '@/services/epg-service'
import { positionInList } from '@/hooks/useAdjacentChannels'
import { useVisibleCatalogItems } from '@/catalog'
import type { EPGData, EPGProgram } from '@/types/epg'
import type { Channel } from '@/types/playlist'

export interface OnAir {
  now: EPGProgram | null
  next: EPGProgram | null
}

const NOTHING: OnAir = { now: null, next: null }

/** What `channel` shows at `at`, and what follows it, from the guide in memory. */
export function onAirFor(guide: EPGData | null, channel: Channel | null, at: number): OnAir {
  if (!guide || !channel || channel.type !== 'live') return NOTHING
  const key = normalizeEpgChannelKey(channel.epgChannelId)
  const programmes = key ? guide.programs[key] : undefined
  if (!programmes || programmes.length === 0) return NOTHING
  const now = findCurrentProgram(programmes, at)
  const coming = getUpcomingPrograms(programmes, 3, at)
  const next = coming.find((programme) => (now ? programme.start >= now.end : programme.start > at)) ?? null
  return { now, next }
}

/** How far `programme` has run at `at`, 0 to 1. */
export function programmeShare(programme: EPGProgram, at: number): number {
  const length = programme.end - programme.start
  if (length <= 0) return 0
  return Math.min(1, Math.max(0, (at - programme.start) / length))
}

/** Whole minutes left of `programme` at `at`. */
export function minutesLeft(programme: EPGProgram, at: number): number {
  return Math.max(0, Math.ceil((programme.end - at) / 60_000))
}

/** The guide of `sourceId`, when that is the guide in memory. */
export function useSourceGuide(sourceId: string | null | undefined): EPGData | null {
  return useStore((s) => (sourceId && s.epgSourceId === sourceId ? s.epgData : null))
}

/**
 * The channel's place (1-based) in its own category as the lists show it, or
 * in the whole list when it has no category: the number the channel list
 * shows beside it, which opens on that category whenever the channel changes.
 * The provider's own channel numbers are not kept, so this is the list's
 * order, not an invented number; null when the channel is not in that list.
 */
export function useChannelNumber(channel: Channel | null): number | null {
  const sourceId = channel?.sourceId ?? null
  const type = channel?.type ?? 'live'
  const list = useVisibleCatalogItems(sourceId, type, channel?.categoryId ?? null)

  return useMemo(() => {
    if (!channel || channel.type !== 'live') return null
    const index = positionInList(list, channel.id)
    return index >= 0 ? index + 1 : null
  }, [channel, list])
}
